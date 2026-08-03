/**
 * Running a command — and being honest that there is nowhere to run it yet.
 *
 * This file used to be 384 lines of WebContainer plumbing: spawning `/bin/jsh`,
 * tee-ing the output into three readers, parsing OSC escape codes to find the
 * prompt, watching for Expo URLs. None of it had worked for a while. The
 * WebContainer runtime was replaced by a shim whose `spawn` throws, so every
 * one of those code paths ended at the first line.
 *
 * It failed in the worst possible way. `ready()` resolves only at the end of
 * `init()`, and `init()` threw before reaching it — so `ready()` never
 * resolved, and `#runShellAction` and `#runStartAction` both begin with
 * `await shell.ready()`. Every `<palmkitAction type="shell">` hung the action
 * queue forever. A project that needed `npm install` did not fail; it stopped,
 * silently, and stayed stopped.
 *
 * A command has to run somewhere real — a cloud sandbox with a filesystem and
 * a process table. Until that is wired up, this says so immediately and with a
 * non-zero exit code, so a build reports "I could not run this" in seconds
 * instead of hanging.
 */
import { atom } from 'nanostores';
import type { ITerminal } from '~/types/terminal';

export type ExecutionResult = { output: string; exitCode: number } | undefined;

/** `command not found` — the closest true thing to "there is no shell". */
const NO_RUNTIME_EXIT_CODE = 127;

const NO_RUNTIME_MESSAGE =
  'No sandbox is attached to this project, so shell commands cannot run yet. ' +
  'Write the files and describe the commands instead.';

/**
 * The shell the action runner talks to.
 *
 * The shape is kept — `ready`, `executeCommand`, `terminal`, `process` — so the
 * runner does not need to know whether anything is behind it. What changed is
 * that every method now answers, promptly, instead of waiting for a runtime
 * that is never coming.
 */
export class PalmkitShell {
  #terminal: ITerminal | undefined;

  executionState = atom<
    { sessionId: string; active: boolean; executionPrms?: Promise<any>; abort?: () => void } | undefined
  >();

  get terminal() {
    return this.#terminal;
  }

  /**
   * Whether a command could actually be run.
   *
   * The runner checks `shell.process` before executing, so this stays falsy
   * while there is no sandbox — which is what makes it skip rather than try.
   */
  get process(): undefined {
    return undefined;
  }

  /** Resolves at once. It resolving late is what used to hang every build. */
  async ready(): Promise<void> {
    return undefined;
  }

  /** Remembers the terminal so output has somewhere to go once one exists. */
  async init(terminal: ITerminal): Promise<void> {
    this.#terminal = terminal;
    terminal.write(`${NO_RUNTIME_MESSAGE}\n`);
  }

  /* `abort` is accepted and ignored: nothing starts, so nothing can be cancelled. */
  async executeCommand(_sessionId: string, command: string, _abort?: () => void): Promise<ExecutionResult> {
    return { output: `${NO_RUNTIME_MESSAGE}\n> ${command}`, exitCode: NO_RUNTIME_EXIT_CODE };
  }
}

export function newPalmkitShellProcess() {
  return new PalmkitShell();
}
