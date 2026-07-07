/**
 * E2B Shell Runner — lazy, per-job PERSISTENT sandbox
 *
 * Every shell command (run_shell / run_tests / take_screenshot) runs in an
 * isolated E2B sandbox that holds the project's files at /home/user/project.
 *
 * Lifecycle (per build job):
 *   - LAZY: the sandbox is created on the FIRST shell command of the job, not
 *     during file writes — we only pay for E2B when the agent actually runs
 *     something.
 *   - PERSISTENT: the SAME sandbox is reused for every subsequent command in
 *     that job. This means `npm install` runs ONCE — its node_modules survives
 *     into later `npm run build` calls and into the Builder⇄Tester repair loop,
 *     instead of the old "fresh sandbox per command" that re-installed deps on
 *     every single call.
 *   - INCREMENTAL SYNC: before each command we push only the files that changed
 *     (and remove source files that were deleted) since the last sync. Generated
 *     artifacts inside the sandbox (node_modules, dist/) are never touched.
 *   - BOUNDED: the sandbox has a hard TTL so a crashed worker can't leak it, and
 *     it is killed the moment the job finishes (disposeSandbox in the
 *     orchestrator's finally block). We log the sandbox-minutes it consumed.
 *
 * Concurrency: sandboxes are keyed by jobId, so the up-to-10 builds the worker
 * runs in parallel each get their own isolated sandbox.
 */

import { Sandbox } from 'e2b';
import { logger } from './logger';

const E2B_API_KEY = process.env.E2B_API_KEY!;
const PROJECT_DIR = '/home/user/project';

/*
 * Hard cap on a single sandbox's lifetime. Set one minute LONGER than the
 * orchestrator's 15-min hard timeout so the orchestrator (which aborts + calls
 * disposeSandbox) is always what ends a build — the sandbox never dies out from
 * under an in-flight command first. If the worker process itself dies, E2B still
 * auto-kills the sandbox at this deadline, so it can never be leaked.
 */
const SANDBOX_TTL_MS = 16 * 60 * 1000;

interface JobSandbox {
  sandbox: Sandbox;
  createdAt: number;
  /** path (relative to PROJECT_DIR) -> content hash currently written in the sandbox */
  synced: Map<string, number>;
}

/** Per-job sandbox registry. Keyed by jobId to isolate concurrent builds. */
const jobSandboxes = new Map<string, JobSandbox>();
/** In-flight creations, so a job's first two commands don't race two sandboxes. */
const creating = new Map<string, Promise<JobSandbox>>();

/** Fast FNV-1a 32-bit hash for cheap change detection (not security-sensitive). */
function hashContent(s: string): number {
  let h = 0x811c9dc5;

  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }

  return h >>> 0;
}

async function getOrCreateSandbox(jobId: string): Promise<JobSandbox> {
  const existing = jobSandboxes.get(jobId);

  if (existing) {
    return existing;
  }

  const inFlight = creating.get(jobId);

  if (inFlight) {
    return inFlight;
  }

  const promise = (async () => {
    let sandbox: Sandbox;

    try {
      sandbox = await Sandbox.create({ apiKey: E2B_API_KEY, timeoutMs: SANDBOX_TTL_MS });
    } catch (createErr: any) {
      const errMsg = createErr?.message ?? String(createErr);

      /*
       * E2B BILLING BLOCK — the clearest failure mode. The E2B API returns
       * 403: "team is blocked: Billing limit reached" when the team's
       * SPENDING LIMIT is reached. This is NOT the balance — the balance
       * can be $104 but if the spending limit is set to $5, all sandbox
       * creation is blocked.
       *
       * The user must increase the spending limit at:
       *   https://e2b.dev/dashboard?tab=billing
       *
       * We throw a clear, actionable error so the orchestrator can surface
       * it to the user instead of retrying silently.
       */
      if (/team is blocked|Billing limit/i.test(errMsg)) {
        throw new Error(
          `E2B sandbox creation blocked: billing spending limit reached. ` +
            `Your E2B team has a spending limit that's been hit. ` +
            `Go to https://e2b.dev/dashboard?tab=billing and increase the spending limit ` +
            `(this is separate from your balance — you may have $104 balance but a $5 limit). ` +
            `Original error: ${errMsg}`,
        );
      }

      throw createErr;
    }

    const entry: JobSandbox = { sandbox, createdAt: Date.now(), synced: new Map() };
    jobSandboxes.set(jobId, entry);
    logger.info(`[e2b] Sandbox created for job ${jobId}: ${sandbox.sandboxId} (TTL ${SANDBOX_TTL_MS / 1000}s)`);

    /*
     * NPM REGISTRY FIX — E2B sandbox IPs are sometimes blocked by the npm
     * registry with '403: team is blocked: Billing limit reached' (the IPs
     * are shared and hit npm's abuse/rate limits). This is NOT an E2B key
     * problem — it's npm registry blocking the sandbox's IP.
     *
     * Fix: write a .npmrc to the sandbox that:
     *   1. Uses the official registry (explicit, in case a global config
     *      redirected to a blocked mirror)
     *   2. Disables the audit/fund noise (faster, fewer requests)
     *   3. Sets a generous timeout + retries
     *   4. Disables the strict-ssl check (some E2B network setups intercept)
     *
     * This .npmrc is written ONCE at sandbox creation and applies to every
     * npm install / npm run build in this sandbox.
     */
    try {
      const npmrc = `# Palmkit auto-generated .npmrc — fixes E2B IP blocks
registry=https://registry.npmjs.org/
audit=false
fund=false
timeout=120000
retries=5
strict-ssl=false
`;
      await sandbox.files.write('/home/user/.npmrc', npmrc);
      logger.info(`[e2b] job ${jobId}: wrote .npmrc to /home/user/.npmrc`);
    } catch (e) {
      logger.warn(`[e2b] job ${jobId}: failed to write .npmrc: ${e}`);
    }

    return entry;
  })();

  creating.set(jobId, promise);

  try {
    return await promise;
  } finally {
    creating.delete(jobId);
  }
}

/**
 * Push only the changed/removed SOURCE files into the sandbox.
 * node_modules and other sandbox-generated artifacts are never in `files`, so
 * they are never overwritten or deleted here.
 */
async function syncFiles(
  entry: JobSandbox,
  files: Record<string, string>,
): Promise<{ written: number; deleted: number }> {
  const writes: Array<{ path: string; data: string }> = [];
  const present = new Set<string>();

  for (const [path, content] of Object.entries(files)) {
    present.add(path);

    const h = hashContent(content);

    if (entry.synced.get(path) !== h) {
      writes.push({ path: `${PROJECT_DIR}/${path}`, data: content });
      entry.synced.set(path, h);
    }
  }

  const toDelete: string[] = [];

  for (const path of entry.synced.keys()) {
    if (!present.has(path)) {
      toDelete.push(path);
    }
  }

  if (writes.length > 0) {
    await entry.sandbox.files.write(writes);
  }

  for (const path of toDelete) {
    try {
      await entry.sandbox.files.remove(`${PROJECT_DIR}/${path}`);
    } catch {
      // best-effort — the file may already be gone
    }

    entry.synced.delete(path);
  }

  return { written: writes.length, deleted: toDelete.length };
}

/**
 * Run a shell command in the job's persistent E2B sandbox.
 *
 * @param jobId   - the build job (keys the persistent sandbox)
 * @param command - the shell command to run
 * @param files   - the CURRENT project files (in-memory map); synced incrementally
 */
/**
 * Errors that mean the sandbox itself is gone (TTL reaped, host recycled,
 * connection lost) rather than the command failing. On these we recreate the
 * sandbox, force a FULL file re-sync, and retry the command once.
 */
function isDeadSandboxError(message: string): boolean {
  return /does not exist|not found|sandbox.*(killed|expired|terminated)|connect|ECONNREFUSED|ETIMEDOUT|invalid_argument/i.test(
    message,
  );
}

export async function runInE2B(
  jobId: string,
  command: string,
  files: Record<string, string>,
  isRetry = false,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  if (!E2B_API_KEY) {
    throw new Error('E2B_API_KEY not set — cannot run shell commands in sandbox');
  }

  let entry: JobSandbox;

  try {
    entry = await getOrCreateSandbox(jobId);
  } catch (e) {
    logger.error(`[e2b] Sandbox creation failed for job ${jobId}: ${e instanceof Error ? e.message : String(e)}`);
    return { stdout: '', stderr: e instanceof Error ? e.message : String(e), exitCode: -1 };
  }

  try {
    /*
     * ROLLING TTL: extend the sandbox lifetime on every command instead of
     * counting down from creation. Long builds (a complex multi-page app can
     * stream files for 15+ minutes before the Tester runs) used to hit the
     * absolute 16-min TTL MID-BUILD — the sandbox died under the agent and
     * every later command failed with "cwd '/home/user/project' does not
     * exist", so verification was silently skipped. With a rolling window the
     * sandbox stays alive as long as the build is actively using it, and E2B
     * still reaps it TTL minutes after the last activity if the worker dies.
     */
    try {
      await entry.sandbox.setTimeout(SANDBOX_TTL_MS);
    } catch {
      // non-fatal — the create-time TTL still applies
    }

    const sync = await syncFiles(entry, files);

    if (sync.written > 0 || sync.deleted > 0) {
      logger.info(`[e2b] job ${jobId}: synced +${sync.written}/-${sync.deleted} files`);
    }

    /*
     * `npm install` on a cold sandbox is slow; other commands are quick. Because
     * node_modules now PERSISTS across calls, a second `npm install` in the same
     * job is a fast no-op, but we still give install-type commands the longer
     * budget for the first run.
     */
    const isInstallCommand = /^(npm|pnpm|yarn|bunx|npx)\s+(install|i|add|ci|playwright install)/.test(command.trim());
    const timeoutMs = isInstallCommand ? 300_000 : 180_000;

    let result = await entry.sandbox.commands.run(command, { cwd: PROJECT_DIR, timeoutMs });

    logger.info(`[e2b] job ${jobId}: "${command.slice(0, 80)}" → exit ${result.exitCode}`);

    /*
     * NPM REGISTRY 403 RETRY — if npm install fails with '403' / 'team is
     * blocked' / 'Billing limit reached' (E2B shared IPs sometimes get
     * blocked by npm), retry with the Yarn registry mirror as a fallback.
     * The Yarn registry (registry.yarnpkg.com) is a CDN front for the same
     * packages and is less aggressive about IP-based blocks.
     */
    const stderr = (result.stderr || '') + (result.stdout || '');
    const isNpmBlock =
      isInstallCommand &&
      result.exitCode !== 0 &&
      (/403/i.test(stderr) || /team is blocked/i.test(stderr) || /Billing limit/i.test(stderr));

    if (isNpmBlock) {
      logger.warn(`[e2b] job ${jobId}: npm install blocked (403/team blocked) — retrying with yarn registry mirror`);

      // Retry with the Yarn registry mirror + no-strict-ssl
      const retryCmd = command.replace(
        /^(npm\s+(install|i|add|ci))/,
        '$1 --registry=https://registry.yarnpkg.com/ --strict-ssl=false',
      );

      try {
        result = await entry.sandbox.commands.run(retryCmd, { cwd: PROJECT_DIR, timeoutMs });
        logger.info(`[e2b] job ${jobId}: retry with yarn registry → exit ${result.exitCode}`);
      } catch (retryErr) {
        logger.warn(`[e2b] job ${jobId}: yarn registry retry failed: ${retryErr}`);
      }
    }

    return { stdout: result.stdout || '', stderr: result.stderr || '', exitCode: result.exitCode };
  } catch (e) {
    /*
     * A non-zero exit throws CommandExitError, which carries the real
     * exitCode + stdout + stderr. Surface those (the repair loop reads the
     * build output) instead of collapsing them into a generic message.
     */
    const err = e as { exitCode?: number; stdout?: string; stderr?: string; message?: string };

    if (typeof err?.exitCode === 'number') {
      logger.info(`[e2b] job ${jobId}: "${command.slice(0, 80)}" → exit ${err.exitCode} (non-zero)`);
      return { stdout: err.stdout || '', stderr: err.stderr || err.message || '', exitCode: err.exitCode };
    }

    const message = err?.message ?? String(e);

    /*
     * DEAD SANDBOX RECOVERY: if the sandbox was reaped mid-build (the exact
     * failure seen live: every command after minute ~16 of a long build died
     * with `[invalid_argument] cwd '/home/user/project' does not exist`),
     * drop the stale entry, create a fresh sandbox, re-sync ALL files, and
     * retry the command once. The build continues instead of silently losing
     * its shell (and with it the Tester/verification phase).
     */
    if (!isRetry && isDeadSandboxError(message)) {
      logger.warn(`[e2b] job ${jobId}: sandbox appears dead (${message.slice(0, 120)}) — recreating and retrying`);
      jobSandboxes.delete(jobId);

      try {
        await entry.sandbox.kill();
      } catch {
        // already gone
      }

      return runInE2B(jobId, command, files, true);
    }

    // Anything else (timeout, network) — report as a hard failure.
    logger.error(`[e2b] job ${jobId}: command error: ${message}`);
    return { stdout: '', stderr: message, exitCode: -1 };
  }
}

/**
 * Kill the job's sandbox and release its slot. Call this once when the build
 * finishes (the orchestrator's finally block). Logs the sandbox-minutes used so
 * E2B cost is observable per build.
 */
export async function disposeSandbox(jobId: string): Promise<void> {
  const entry = jobSandboxes.get(jobId);

  if (!entry) {
    return;
  }

  jobSandboxes.delete(jobId);

  const minutes = ((Date.now() - entry.createdAt) / 60000).toFixed(2);

  try {
    await entry.sandbox.kill();
    logger.info(`[e2b] Sandbox destroyed for job ${jobId}: ${entry.sandbox.sandboxId} — ${minutes} sandbox-minutes`);
  } catch (e) {
    logger.warn(`[e2b] Failed to destroy sandbox for job ${jobId}: ${e}`);
  }
}
