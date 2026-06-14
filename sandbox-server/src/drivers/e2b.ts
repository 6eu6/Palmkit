/**
 * E2B driver — managed cloud microVM sandboxes (firecracker).
 *
 * Fastest path to production-grade reliability and isolation. Free tier to
 * start, then pay-as-you-go. Enabled with SANDBOX_DRIVER=e2b + E2B_API_KEY.
 *
 * The `e2b` package is an optionalDependency; this module is only imported when
 * the driver is selected, so the server runs without it for the docker driver.
 */
import type { SandboxDriver, SandboxHandle, StartOptions } from './types.js';

type AnySandbox = {
  sandboxId: string;
  files: { write: (path: string, data: string) => Promise<unknown> };
  commands: { run: (cmd: string, opts?: Record<string, unknown>) => Promise<unknown> };
  getHost: (port: number) => string;
  kill: () => Promise<void>;
};

const sandboxes = new Map<string, AnySandbox>();

export const e2bDriver: SandboxDriver = {
  name: 'e2b',

  async create(): Promise<SandboxHandle> {
    const { Sandbox } = (await import('e2b')) as unknown as {
      Sandbox: { create: (opts: { apiKey?: string }) => Promise<AnySandbox> };
    };
    const sbx = await Sandbox.create({ apiKey: process.env.E2B_API_KEY });
    sandboxes.set(sbx.sandboxId, sbx);

    return { id: sbx.sandboxId, upstream: '', lastActiveAt: Date.now() };
  },

  async writeFiles(id, files) {
    const sbx = sandboxes.get(id);

    if (!sbx) {
      throw new Error(`sandbox ${id} not found`);
    }

    for (const [path, contents] of Object.entries(files)) {
      await sbx.files.write(`/home/user/${path.replace(/^\/+/, '')}`, contents);
    }
  },

  async start(id, opts: StartOptions) {
    const sbx = sandboxes.get(id);

    if (!sbx) {
      throw new Error(`sandbox ${id} not found`);
    }

    await sbx.commands.run(`cd /home/user && ${opts.install}`);
    // run dev server in the background
    await sbx.commands.run(`cd /home/user && nohup ${opts.dev} > /tmp/dev.log 2>&1 &`, { background: true });

    const host = sbx.getHost(opts.port);

    return { upstream: `https://${host}` };
  },

  async logs(id) {
    const sbx = sandboxes.get(id);

    if (!sbx) {
      return 'sandbox not found';
    }

    return '(stream logs via e2b commands.run("tail -f /tmp/dev.log"))';
  },

  async destroy(id) {
    const sbx = sandboxes.get(id);

    if (!sbx) {
      return;
    }

    sandboxes.delete(id);
    await sbx.kill();
  },
};
