import { atom, type WritableAtom } from 'nanostores';
import type { ITerminal } from '~/types/terminal';
import { newPalmkitShellProcess } from '~/utils/shell';

/**
 * The terminal panel.
 *
 * It used to hold a WebContainer and spawn a shell into every terminal the
 * user opened. There has been no WebContainer for a while — a shim satisfied
 * the interface and its `spawn` threw — so both attach paths ended by writing
 * a red error into the panel.
 *
 * What is left is the part that still means something: the toggle, and one
 * shell object for the action runner to talk to. Attaching a terminal now says
 * plainly that there is nowhere to run commands, rather than dressing it as a
 * failure to spawn.
 */
export class TerminalStore {
  #palmkitTerminal = newPalmkitShellProcess();

  showTerminal: WritableAtom<boolean> = import.meta.hot?.data?.showTerminal ?? atom(true);

  constructor() {
    if (import.meta.hot?.data) {
      import.meta.hot.data.showTerminal = this.showTerminal;
    }
  }

  get palmkitTerminal() {
    return this.#palmkitTerminal;
  }

  toggleTerminal(value?: boolean) {
    this.showTerminal.set(value !== undefined ? value : !this.showTerminal.get());
  }

  async attachPalmkitTerminal(terminal: ITerminal) {
    await this.#palmkitTerminal.init(terminal);
  }

  /**
   * A second terminal the user opened themselves.
   *
   * Nothing can be spawned into it, so it says so instead of appearing to work.
   */
  async attachTerminal(terminal: ITerminal) {
    terminal.write('No sandbox is attached to this project, so there is no shell to open yet.\n');
  }

  /*
   * Kept so the resize and detach callers do not need to know there is
   * nothing behind them. There is no process to resize and none to kill.
   */
  onTerminalResize(_cols: number, _rows: number) {
    return undefined;
  }

  async detachTerminal(_terminal: ITerminal) {
    return undefined;
  }
}
