/**
 * BuildTerminal — a read-only, live view of the shell commands the worker runs
 * in the cloud sandbox (E2B).
 *
 * The old "Palmkit Terminal" was an in-browser xterm bound to a local shell,
 * which can't exist here (the real shell runs in E2B on the Oracle worker) — so
 * it only ever printed "Failed to spawn Palmkit shell". This replaces it with
 * the actual thing the user wants to see: each `run_shell` the agent issues
 * appears as `$ command` with a spinner while it runs, then its stdout/stderr
 * and exit code stream in. Fed by terminalOutputStore (worker shell_command /
 * shell_output events).
 */
import { useEffect, useRef } from 'react';
import { useStore } from '@nanostores/react';
import { terminalOutputStore } from '~/lib/stores/build-status';
import { classNames } from '~/utils/classNames';

export function BuildTerminal({ className }: { className?: string }) {
  const lines = useStore(terminalOutputStore);
  const endRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the newest output as commands stream in.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [lines]);

  return (
    <div
      className={classNames(
        'h-full overflow-auto modern-scrollbar-invert bg-palmkit-elements-terminals-background px-3 py-2 font-mono text-xs leading-relaxed',
        className,
      )}
    >
      {lines.length === 0 ? (
        <div className="text-palmkit-elements-textTertiary">
          Commands the agent runs in the cloud sandbox (E2B) stream here live during a build.
        </div>
      ) : (
        lines.map((line) => (
          <div key={line.seq} className="mb-2">
            <div className="flex items-center gap-2">
              <span className="text-palmkit-elements-textTertiary">$</span>
              <span className="text-palmkit-elements-textPrimary break-all">{line.command}</span>
              {line.running ? (
                <span className="i-svg-spinners:90-ring-with-bg shrink-0 text-blue-400" />
              ) : (
                <span
                  className={classNames(
                    'shrink-0 text-[11px] tabular-nums',
                    line.exitCode === 0 ? 'text-green-400' : 'text-red-400',
                  )}
                >
                  exit {line.exitCode}
                </span>
              )}
            </div>

            {(line.stdout || line.stderr) && (
              <pre className="mt-1 whitespace-pre-wrap break-all text-palmkit-elements-textSecondary">
                {line.stdout}
                {line.stderr ? (line.stdout ? '\n' : '') + line.stderr : ''}
              </pre>
            )}
          </div>
        ))
      )}
      <div ref={endRef} />
    </div>
  );
}
