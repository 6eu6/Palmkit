import { path as nodePath } from '~/utils/path';
import { WORK_DIR } from '~/utils/constants';
import { atom, map, type MapStore } from 'nanostores';
import type {
  ActionAlert,
  PalmkitAction,
  DeployAlert,
  FileHistory,
  SupabaseAction,
  SupabaseAlert,
} from '~/types/actions';
import { createScopedLogger } from '~/utils/logger';
import { unreachable } from '~/utils/unreachable';
import { applyEdit } from '~/lib/runtime/apply-edit';
import type { ActionCallbackData } from './message-parser';
import type { PalmkitShell } from '~/utils/shell';
import { isRemoteSandboxAvailable } from '~/lib/sandbox/remoteSandbox';

const logger = createScopedLogger('ActionRunner');

/**
 * Where a command runs — and whether it can run at all.
 *
 * This used to be a decision between two runtimes: the in-browser
 * WebContainer by default, with the E2B cloud sandbox as a fallback when
 * WebContainer could not boot. It waited up to fifteen seconds for that boot,
 * polling a `webcontainerContext.loaded` flag.
 *
 * There has been no WebContainer for a long time. The shim that replaced it
 * sets `loaded = true` the moment it resolves, so on any desktop browser the
 * first branch matched immediately, the function returned "run locally", and
 * the sandbox was never reached. Nothing ran locally either — the shim's
 * `spawn` throws. So on desktop, commands went nowhere at all, which is why a
 * project needing `npm install` never produced a preview.
 *
 * There is one place a command can run now, so the only question left is
 * whether it is reachable.
 */
async function shouldOffloadExecution(): Promise<boolean> {
  const available = await isRemoteSandboxAvailable();

  if (!available) {
    logger.warn('[offload] no cloud sandbox is available — shell, start and build actions cannot run.');
  }

  return available;
}

export type ActionStatus = 'pending' | 'running' | 'complete' | 'aborted' | 'failed';

export type BaseActionState = PalmkitAction & {
  status: Exclude<ActionStatus, 'failed'>;
  abort: () => void;
  executed: boolean;
  abortSignal: AbortSignal;
};

export type FailedActionState = PalmkitAction &
  Omit<BaseActionState, 'status'> & {
    status: Extract<ActionStatus, 'failed'>;
    error: string;
  };

export type ActionState = BaseActionState | FailedActionState;

type BaseActionUpdate = Partial<Pick<BaseActionState, 'status' | 'abort' | 'executed'>>;

export type ActionStateUpdate =
  | BaseActionUpdate
  | (Omit<BaseActionUpdate, 'status'> & { status: 'failed'; error: string });

type ActionsMap = MapStore<Record<string, ActionState>>;

class ActionCommandError extends Error {
  readonly _output: string;
  readonly _header: string;

  constructor(message: string, output: string) {
    // Create a formatted message that includes both the error message and output
    const formattedMessage = `Failed To Execute Shell Command: ${message}\n\nOutput:\n${output}`;
    super(formattedMessage);

    // Set the output separately so it can be accessed programmatically
    this._header = message;
    this._output = output;

    // Maintain proper prototype chain
    Object.setPrototypeOf(this, ActionCommandError.prototype);

    // Set the name of the error for better debugging
    this.name = 'ActionCommandError';
  }

  // Optional: Add a method to get just the terminal output
  get output() {
    return this._output;
  }
  get header() {
    return this._header;
  }
}

export class ActionRunner {
  #currentExecutionPromise: Promise<void> = Promise.resolve();
  #shellTerminal: () => PalmkitShell;
  runnerId = atom<string>(`${Date.now()}`);
  actions: ActionsMap = map({});
  onAlert?: (alert: ActionAlert) => void;
  onSupabaseAlert?: (alert: SupabaseAlert) => void;
  onDeployAlert?: (alert: DeployAlert) => void;
  onFileWritten?: (filePath: string, content: string, isBinary?: boolean) => void;

  /**
   * The current text of a file the project already has.
   *
   * Needed by the edit action, whose whole point is that the model did not
   * send the file. Reads from the workbench's own copy — the same one the
   * editor and the preview show — so an edit applies to what the user is
   * looking at rather than to whatever is on a disk that may not have booted.
   */
  readFile?: (filePath: string) => string | undefined;
  buildOutput?: { path: string; exitCode: number; output: string };

  constructor(
    getShellTerminal: () => PalmkitShell,
    onAlert?: (alert: ActionAlert) => void,
    onSupabaseAlert?: (alert: SupabaseAlert) => void,
    onDeployAlert?: (alert: DeployAlert) => void,
    onFileWritten?: (filePath: string, content: string, isBinary?: boolean) => void,
    readFile?: (filePath: string) => string | undefined,
  ) {
    this.#shellTerminal = getShellTerminal;
    this.onAlert = onAlert;
    this.onSupabaseAlert = onSupabaseAlert;
    this.onDeployAlert = onDeployAlert;
    this.onFileWritten = onFileWritten;
    this.readFile = readFile;
  }

  addAction(data: ActionCallbackData) {
    const { actionId } = data;

    const actions = this.actions.get();
    const action = actions[actionId];

    if (action) {
      // action already added
      return;
    }

    const abortController = new AbortController();

    this.actions.setKey(actionId, {
      ...data.action,
      status: 'pending',
      executed: false,
      abort: () => {
        abortController.abort();
        this.#updateAction(actionId, { status: 'aborted' });
      },
      abortSignal: abortController.signal,
    });

    this.#currentExecutionPromise.then(() => {
      this.#updateAction(actionId, { status: 'running' });
    });
  }

  async runAction(data: ActionCallbackData, isStreaming: boolean = false) {
    const { actionId } = data;
    const action = this.actions.get()[actionId];

    if (!action) {
      unreachable(`Action ${actionId} not found`);
    }

    if (action.executed) {
      return; // No return value here
    }

    if (isStreaming && action.type !== 'file') {
      return; // No return value here
    }

    this.#updateAction(actionId, { ...action, ...data.action, executed: !isStreaming });

    this.#currentExecutionPromise = this.#currentExecutionPromise
      .then(() => {
        return this.#executeAction(actionId, isStreaming);
      })
      .catch((error) => {
        logger.error('Action execution promise failed:', error);
      });

    await this.#currentExecutionPromise;

    return;
  }

  async #executeAction(actionId: string, isStreaming: boolean = false) {
    const action = this.actions.get()[actionId];

    // Offload command execution to the cloud sandbox on mobile (files still run locally).
    if (
      (action.type === 'shell' || action.type === 'start' || action.type === 'build') &&
      (await shouldOffloadExecution())
    ) {
      logger.info(`[${action.type}] offloaded to cloud sandbox; skipping in-browser execution`);
      this.#updateAction(actionId, { status: 'complete' });

      return;
    }

    this.#updateAction(actionId, { status: 'running' });

    try {
      switch (action.type) {
        case 'shell': {
          await this.#runShellAction(action);
          break;
        }
        case 'file': {
          await this.#runFileAction(action);
          break;
        }
        case 'asset': {
          await this.#runAssetAction(action);
          break;
        }
        case 'edit': {
          await this.#runEditAction(action);
          break;
        }
        case 'supabase': {
          try {
            await this.handleSupabaseAction(action as SupabaseAction);
          } catch (error: any) {
            // Update action status
            this.#updateAction(actionId, {
              status: 'failed',
              error: error instanceof Error ? error.message : 'Supabase action failed',
            });

            // Return early without re-throwing
            return;
          }
          break;
        }
        case 'build': {
          const buildOutput = await this.#runBuildAction(action);

          // Store build output for deployment
          this.buildOutput = buildOutput;
          break;
        }
        case 'start': {
          // making the start app non blocking

          this.#runStartAction(action)
            .then(() => this.#updateAction(actionId, { status: 'complete' }))
            .catch((err: Error) => {
              if (action.abortSignal.aborted) {
                return;
              }

              this.#updateAction(actionId, { status: 'failed', error: 'Action failed' });
              logger.error(`[${action.type}]:Action failed\n\n`, err);

              if (!(err instanceof ActionCommandError)) {
                return;
              }

              this.onAlert?.({
                type: 'error',
                title: 'Dev Server Failed',
                description: err.header,
                content: err.output,
              });
            });

          /*
           * adding a delay to avoid any race condition between 2 start actions
           * i am up for a better approach
           */
          await new Promise((resolve) => setTimeout(resolve, 2000));

          return;
        }
      }

      this.#updateAction(actionId, {
        status: isStreaming ? 'running' : action.abortSignal.aborted ? 'aborted' : 'complete',
      });
    } catch (error) {
      if (action.abortSignal.aborted) {
        return;
      }

      this.#updateAction(actionId, { status: 'failed', error: 'Action failed' });
      logger.error(`[${action.type}]:Action failed\n\n`, error);

      if (!(error instanceof ActionCommandError)) {
        return;
      }

      this.onAlert?.({
        type: 'error',
        title: 'Dev Server Failed',
        description: error.header,
        content: error.output,
      });

      // re-throw the error to be caught in the promise chain
      throw error;
    }
  }

  async #runShellAction(action: ActionState) {
    if (action.type !== 'shell') {
      unreachable('Expected shell action');
    }

    const shell = this.#shellTerminal();
    await shell.ready();

    if (!shell || !shell.terminal || !shell.process) {
      unreachable('Shell terminal not found');
    }

    // Pre-validate command for common issues
    const validationResult = await this.#validateShellCommand(action.content);

    if (validationResult.shouldModify && validationResult.modifiedCommand) {
      logger.debug(`Modified command: ${action.content} -> ${validationResult.modifiedCommand}`);
      action.content = validationResult.modifiedCommand;
    }

    const resp = await shell.executeCommand(this.runnerId.get(), action.content, () => {
      logger.debug(`[${action.type}]:Aborting Action\n\n`, action);
      action.abort();
    });
    logger.debug(`${action.type} Shell Response: [exit code:${resp?.exitCode}]`);

    if (resp?.exitCode != 0) {
      const enhancedError = this.#createEnhancedShellError(action.content, resp?.exitCode, resp?.output);
      throw new ActionCommandError(enhancedError.title, enhancedError.details);
    }
  }

  async #runStartAction(action: ActionState) {
    if (action.type !== 'start') {
      unreachable('Expected shell action');
    }

    if (!this.#shellTerminal) {
      unreachable('Shell terminal not found');
    }

    const shell = this.#shellTerminal();
    await shell.ready();

    if (!shell || !shell.terminal || !shell.process) {
      unreachable('Shell terminal not found');
    }

    const resp = await shell.executeCommand(this.runnerId.get(), action.content, () => {
      logger.debug(`[${action.type}]:Aborting Action\n\n`, action);
      action.abort();
    });
    logger.debug(`${action.type} Shell Response: [exit code:${resp?.exitCode}]`);

    if (resp?.exitCode != 0) {
      throw new ActionCommandError('Failed To Start Application', resp?.output || 'No Output Available');
    }

    return resp;
  }

  async #runFileAction(action: ActionState) {
    if (action.type !== 'file') {
      unreachable('Expected file action');
    }

    /*
     * Nothing is written to a disk here.
     *
     * This used to race a WebContainer boot against a ten-second timeout and
     * then write through `fs`. The shim behind that API wrote into the
     * workbench store — which is where `onFileWritten` below puts it anyway —
     * so the write was a slower second route to the same place, and the
     * ten-second wait was for a boot that had already resolved.
     */
    /*
     * Proactively register the file with the workbench so it appears in the
     * file tree/preview immediately, without depending on the FS watcher
     * (which is unreliable on some platforms, notably mobile browsers).
     *
     * IMPORTANT: always call this — even when WebContainer fails — so that
     * the E2B remote preview path has files to push.
     */
    this.onFileWritten?.(action.filePath, action.content);
  }

  /**
   * Change part of a file the project already has.
   *
   * The whole point is that the model did not send the file, so the current
   * contents have to come from somewhere. They come from the same place the
   * editor and preview read: the workbench's own copy, via `readFile`.
   *
   * A failed edit is reported rather than swallowed. The model can only
   * recover — by widening its search text or sending the file outright — if it
   * is told what went wrong, and a silently skipped edit leaves it believing
   * a change landed that did not.
   */
  async #runEditAction(action: ActionState) {
    if (action.type !== 'edit') {
      unreachable('Expected edit action');
    }

    const current = this.readFile?.(action.filePath);

    if (typeof current !== 'string') {
      throw new ActionCommandError(
        `Cannot edit ${action.filePath} — it is not in the project yet.`,
        'Write it with a file action first.',
      );
    }

    const outcome = applyEdit(current, action.content);

    if (!outcome.ok) {
      throw new ActionCommandError(`Could not edit ${action.filePath}`, outcome.error ?? 'The edit did not apply.');
    }

    logger.debug(`[runEditAction] applied ${outcome.applied} change(s) to ${action.filePath}`);

    /*
     * Written through the file action, so an edit lands exactly the way a
     * rewrite does — same folder creation, same fallback when the container
     * has not booted, same registration with the workbench.
     */
    await this.#runFileAction({ ...action, type: 'file', content: outcome.content } as ActionState);
  }

  /**
   * Write a generated image or video into the project as a real file.
   *
   * A `file` action carries its content in the stream, which cannot work for
   * a JPEG: the bytes would have to be base64 in the response, and the
   * response goes back into the model's context. So the action carries a
   * link and the bytes are fetched here, in the browser, where they are
   * needed and nowhere else.
   *
   * This is what makes a generated asset survive. Before it, the only way to
   * use one was to reference the storage URL directly from the page — a link
   * that expires in seven days, is absent from an export, and turns the site
   * into broken images a week later.
   */
  async #runAssetAction(action: ActionState) {
    if (action.type !== 'asset') {
      unreachable('Expected asset action');
    }

    const res = await fetch(action.src);

    if (!res.ok) {
      throw new ActionCommandError(`Could not fetch the asset (HTTP ${res.status})`, action.src);
    }

    const bytes = new Uint8Array(await res.arrayBuffer());

    /* Straight into the workbench, the same way a file action lands. */
    let binary = '';

    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }

    this.onFileWritten?.(action.filePath, btoa(binary), true);
  }

  #updateAction(id: string, newState: ActionStateUpdate) {
    const actions = this.actions.get();

    this.actions.setKey(id, { ...actions[id], ...newState });
  }

  /**
   * Does the project have this path?
   *
   * The shell-command checks below used to answer this with `fs.readFile` on
   * the WebContainer. The workbench is where the files are, and a relative
   * path in a command is relative to the project root.
   */
  #exists(candidate: string): boolean {
    const full = candidate.startsWith('/') ? candidate : nodePath.join(WORK_DIR, candidate);

    return this.readFile?.(full) !== undefined;
  }

  async getFileHistory(filePath: string): Promise<FileHistory | null> {
    try {
      const content = this.readFile?.(this.#getHistoryPath(filePath));

      return content ? JSON.parse(content) : null;
    } catch (error) {
      logger.error('Failed to get file history:', error);
      return null;
    }
  }

  async saveFileHistory(filePath: string, history: FileHistory) {
    const historyPath = this.#getHistoryPath(filePath);

    await this.#runFileAction({
      type: 'file',
      filePath: historyPath,
      content: JSON.stringify(history),
      changeSource: 'auto-save',
    } as any);
  }

  #getHistoryPath(filePath: string) {
    return nodePath.join('.history', filePath);
  }

  /**
   * Build the project — which needs a process, and there is none in a browser.
   *
   * This used to `spawn('npm', ['run', 'build'])` on the WebContainer, pipe
   * the output into a terminal, then hunt through dist, build, out, public and
   * the rest for whatever it produced. All of it ran against a shim whose
   * `spawn` throws, so the first line was as far as it ever got.
   *
   * Build actions are handed to the cloud sandbox before they reach here — see
   * shouldOffloadExecution. This is what is left for when there is no sandbox
   * to hand them to, and saying so plainly beats an exception about a missing
   * runtime.
   */
  async #runBuildAction(action: ActionState): Promise<never> {
    if (action.type !== 'build') {
      unreachable('Expected build action');
    }

    this.handleDeployAction('building', 'failed', {
      error: 'No sandbox is attached to this project.',
    });

    throw new ActionCommandError(
      'Cannot build without a sandbox',
      'No cloud sandbox is attached to this project, so `npm run build` has nowhere to run.',
    );
  }

  async handleSupabaseAction(action: SupabaseAction) {
    const { operation, content, filePath } = action;
    logger.debug('[Supabase Action]:', { operation, filePath, content });

    switch (operation) {
      case 'migration':
        if (!filePath) {
          throw new Error('Migration requires a filePath');
        }

        // Show alert for migration action
        this.onSupabaseAlert?.({
          type: 'info',
          title: 'Supabase Migration',
          description: `Create migration file: ${filePath}`,
          content,
          source: 'supabase',
        });

        // Only create the migration file
        await this.#runFileAction({
          type: 'file',
          filePath,
          content,
          changeSource: 'supabase',
        } as any);
        return { success: true };

      case 'query': {
        // Always show the alert and let the SupabaseAlert component handle connection state
        this.onSupabaseAlert?.({
          type: 'info',
          title: 'Supabase Query',
          description: 'Execute database query',
          content,
          source: 'supabase',
        });

        // The actual execution will be triggered from SupabaseChatAlert
        return { pending: true };
      }

      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
  }

  // Add this method declaration to the class
  handleDeployAction(
    stage: 'building' | 'deploying' | 'complete',
    status: ActionStatus,
    details?: {
      url?: string;
      error?: string;
      source?: 'netlify' | 'vercel' | 'github' | 'gitlab';
    },
  ): void {
    if (!this.onDeployAlert) {
      logger.debug('No deploy alert handler registered');
      return;
    }

    const alertType = status === 'failed' ? 'error' : status === 'complete' ? 'success' : 'info';

    const title =
      stage === 'building'
        ? 'Building Application'
        : stage === 'deploying'
          ? 'Deploying Application'
          : 'Deployment Complete';

    const description =
      status === 'failed'
        ? `${stage === 'building' ? 'Build' : 'Deployment'} failed`
        : status === 'running'
          ? `${stage === 'building' ? 'Building' : 'Deploying'} your application...`
          : status === 'complete'
            ? `${stage === 'building' ? 'Build' : 'Deployment'} completed successfully`
            : `Preparing to ${stage === 'building' ? 'build' : 'deploy'} your application`;

    const buildStatus =
      stage === 'building' ? status : stage === 'deploying' || stage === 'complete' ? 'complete' : 'pending';

    const deployStatus = stage === 'building' ? 'pending' : status;

    this.onDeployAlert({
      type: alertType,
      title,
      description,
      content: details?.error || '',
      url: details?.url,
      stage,
      buildStatus: buildStatus as any,
      deployStatus: deployStatus as any,
      source: details?.source || 'netlify',
    });
  }

  async #validateShellCommand(command: string): Promise<{
    shouldModify: boolean;
    modifiedCommand?: string;
    warning?: string;
  }> {
    const trimmedCommand = command.trim();

    // Handle rm commands that might fail due to missing files
    if (trimmedCommand.startsWith('rm ') && !trimmedCommand.includes(' -f')) {
      const rmMatch = trimmedCommand.match(/^rm\s+(.+)$/);

      if (rmMatch) {
        const filePaths = rmMatch[1].split(/\s+/);

        try {
          const existingFiles = filePaths.filter((p) => !p.startsWith('-') && this.#exists(p));

          if (existingFiles.length === 0) {
            // No files exist, modify command to use -f flag to avoid error
            return {
              shouldModify: true,
              modifiedCommand: `rm -f ${filePaths.join(' ')}`,
              warning: 'Added -f flag to rm command as target files do not exist',
            };
          } else if (existingFiles.length < filePaths.length) {
            // Some files don't exist, modify to only remove existing ones with -f for safety
            return {
              shouldModify: true,
              modifiedCommand: `rm -f ${filePaths.join(' ')}`,
              warning: 'Added -f flag to rm command as some target files do not exist',
            };
          }
        } catch (error) {
          logger.debug('Could not validate rm command files:', error);
        }
      }
    }

    // Handle cd commands to non-existent directories
    if (trimmedCommand.startsWith('cd ')) {
      const cdMatch = trimmedCommand.match(/^cd\s+(.+)$/);

      if (cdMatch) {
        const targetDir = cdMatch[1].trim();

        if (!this.#exists(targetDir)) {
          return {
            shouldModify: true,
            modifiedCommand: `mkdir -p ${targetDir} && cd ${targetDir}`,
            warning: 'Directory does not exist, created it first',
          };
        }
      }
    }

    // Handle cp/mv commands with missing source files
    if (trimmedCommand.match(/^(cp|mv)\s+/)) {
      const parts = trimmedCommand.split(/\s+/);

      if (parts.length >= 3) {
        const sourceFile = parts[1];

        if (!this.#exists(sourceFile)) {
          return {
            shouldModify: false,
            warning: `Source file '${sourceFile}' does not exist`,
          };
        }
      }
    }

    return { shouldModify: false };
  }

  #createEnhancedShellError(
    command: string,
    exitCode: number | undefined,
    output: string | undefined,
  ): {
    title: string;
    details: string;
  } {
    const trimmedCommand = command.trim();
    const firstWord = trimmedCommand.split(/\s+/)[0];

    // Common error patterns and their explanations
    const errorPatterns = [
      {
        pattern: /cannot remove.*No such file or directory/,
        title: 'File Not Found',
        getMessage: () => {
          const fileMatch = output?.match(/'([^']+)'/);
          const fileName = fileMatch ? fileMatch[1] : 'file';

          return `The file '${fileName}' does not exist and cannot be removed.\n\nSuggestion: Use 'ls' to check what files exist, or use 'rm -f' to ignore missing files.`;
        },
      },
      {
        pattern: /No such file or directory/,
        title: 'File or Directory Not Found',
        getMessage: () => {
          if (trimmedCommand.startsWith('cd ')) {
            const dirMatch = trimmedCommand.match(/cd\s+(.+)/);
            const dirName = dirMatch ? dirMatch[1] : 'directory';

            return `The directory '${dirName}' does not exist.\n\nSuggestion: Use 'mkdir -p ${dirName}' to create it first, or check available directories with 'ls'.`;
          }

          return `The specified file or directory does not exist.\n\nSuggestion: Check the path and use 'ls' to see available files.`;
        },
      },
      {
        pattern: /Permission denied/,
        title: 'Permission Denied',
        getMessage: () =>
          `Permission denied for '${firstWord}'.\n\nSuggestion: The file may not be executable. Try 'chmod +x filename' first.`,
      },
      {
        pattern: /command not found/,
        title: 'Command Not Found',
        getMessage: () =>
          `The command '${firstWord}' is not available in the sandbox.\n\nSuggestion: Check available commands or use a package manager to install it.`,
      },
      {
        pattern: /Is a directory/,
        title: 'Target is a Directory',
        getMessage: () =>
          `Cannot perform this operation - target is a directory.\n\nSuggestion: Use 'ls' to list directory contents or add appropriate flags.`,
      },
      {
        pattern: /File exists/,
        title: 'File Already Exists',
        getMessage: () => `File already exists.\n\nSuggestion: Use a different name or add '-f' flag to overwrite.`,
      },
    ];

    // Try to match known error patterns
    for (const errorPattern of errorPatterns) {
      if (output && errorPattern.pattern.test(output)) {
        return {
          title: errorPattern.title,
          details: errorPattern.getMessage(),
        };
      }
    }

    // Generic error with suggestions based on command type
    let suggestion = '';

    if (trimmedCommand.startsWith('npm ')) {
      suggestion = '\n\nSuggestion: Try running "npm install" first or check package.json.';
    } else if (trimmedCommand.startsWith('git ')) {
      suggestion = "\n\nSuggestion: Check if you're in a git repository or if remote is configured.";
    } else if (trimmedCommand.match(/^(ls|cat|rm|cp|mv)/)) {
      suggestion = '\n\nSuggestion: Check file paths and use "ls" to see available files.';
    }

    return {
      title: `Command Failed (exit code: ${exitCode})`,
      details: `Command: ${trimmedCommand}\n\nOutput: ${output || 'No output available'}${suggestion}`,
    };
  }

  /**
   * Abort ALL in-flight actions (shell commands, file writes, dev servers).
   * Called when the user clicks Stop — every pending/running action gets its
   * AbortController fired so fetch streams close and shell processes die.
   */
  abortAll() {
    const actions = this.actions.get();
    let aborted = 0;

    for (const action of Object.values(actions)) {
      if (action.status === 'pending' || action.status === 'running') {
        action.abort();
        aborted++;
      }
    }

    if (aborted > 0) {
      logger.info(`[ActionRunner] Aborted ${aborted} in-flight action(s)`);
    }
  }
}
