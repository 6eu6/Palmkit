/**
 * RunShellRenderer
 * ================
 * Renders the result of the `run_shell` tool.
 *
 * Shows: command, exit code, stdout, stderr with syntax highlighting.
 * Stdout and stderr are displayed in terminal-like panels.
 */

import { memo, useState } from 'react';
import { ToolResultHeader } from '~/components/chat/tool-results/shared/ToolResultHeader';
import { classNames } from '~/utils/classNames';

interface RunShellRendererProps {
  result: unknown;
  theme: 'light' | 'dark';
}

interface RunShellResult {
  ok: boolean;
  command?: string;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  success?: boolean;
  stdoutTruncated?: boolean;
  stdoutOriginalLength?: number;
  stderrTruncated?: boolean;
  stderrOriginalLength?: number;
  error?: string;
  hint?: string;
}

function RunShellRendererImpl({ result, theme: _theme }: RunShellRendererProps) {
  const [activeTab, setActiveTab] = useState<'stdout' | 'stderr'>('stdout');

  const data = result as RunShellResult;

  if (!data.ok) {
    return (
      <div className="bg-palmkit-elements-background-depth-1 p-4 rounded-md">
        <ToolResultHeader
          toolName="run_shell"
          label="Shell Command"
          iconClass="i-ph:terminal"
          success={false}
          error={data.error}
        />
        {data.hint && <div className="mt-2 text-xs text-palmkit-elements-textSecondary">{data.hint}</div>}
      </div>
    );
  }

  const hasStdout = data.stdout && data.stdout.length > 0;
  const hasStderr = data.stderr && data.stderr.length > 0;
  const success = data.exitCode === 0;

  return (
    <div className="bg-palmkit-elements-background-depth-1 p-4 rounded-md">
      <ToolResultHeader
        toolName="run_shell"
        label="Shell Command"
        iconClass="i-ph:terminal"
        success={success}
        error={success ? undefined : `Exit code ${data.exitCode}`}
        meta={
          data.exitCode !== undefined && (
            <span
              className={classNames(
                'text-xs font-mono',
                success ? 'text-palmkit-elements-icon-success' : 'text-palmkit-elements-icon-error',
              )}
            >
              exit {data.exitCode}
            </span>
          )
        }
      />

      <div className="mb-3 p-2 rounded-md bg-[#0A0A0A] text-white font-mono text-xs">
        <span className="text-green-400">$</span> <span className="text-gray-200">{data.command}</span>
      </div>

      {(hasStdout || hasStderr) && (
        <>
          <div className="flex gap-1 mb-2 border-b border-palmkit-elements-borderColor">
            <button
              onClick={() => setActiveTab('stdout')}
              disabled={!hasStdout}
              className={classNames(
                'px-3 py-1.5 text-xs font-medium border-b-2 transition-colors',
                activeTab === 'stdout' && hasStdout
                  ? 'border-palmkit-elements-item-contentAccent text-palmkit-elements-textPrimary'
                  : 'border-transparent text-palmkit-elements-textSecondary',
                !hasStdout && 'opacity-40 cursor-not-allowed',
              )}
            >
              stdout
              {hasStdout && (
                <span className="ml-1 text-[10px] text-palmkit-elements-textSecondary">
                  ({data.stdout?.length ?? 0})
                </span>
              )}
              {data.stdoutTruncated && <span className="ml-1 text-[10px] text-palmkit-elements-icon-warning">✂</span>}
            </button>
            <button
              onClick={() => setActiveTab('stderr')}
              disabled={!hasStderr}
              className={classNames(
                'px-3 py-1.5 text-xs font-medium border-b-2 transition-colors',
                activeTab === 'stderr' && hasStderr
                  ? 'border-palmkit-elements-item-contentAccent text-palmkit-elements-textPrimary'
                  : 'border-transparent text-palmkit-elements-textSecondary',
                !hasStderr && 'opacity-40 cursor-not-allowed',
              )}
            >
              stderr
              {hasStderr && (
                <span className="ml-1 text-[10px] text-palmkit-elements-textSecondary">
                  ({data.stderr?.length ?? 0})
                </span>
              )}
              {data.stderrTruncated && <span className="ml-1 text-[10px] text-palmkit-elements-icon-warning">✂</span>}
            </button>
          </div>

          <div className="bg-[#0A0A0A] text-white p-3 rounded-md font-mono text-xs overflow-auto max-h-80">
            <pre className="whitespace-pre-wrap break-all">{activeTab === 'stdout' ? data.stdout : data.stderr}</pre>
          </div>

          {activeTab === 'stdout' && data.stdoutTruncated && (
            <div className="mt-1 text-[10px] text-palmkit-elements-icon-warning">
              Output truncated from {data.stdoutOriginalLength?.toLocaleString()} chars
            </div>
          )}
          {activeTab === 'stderr' && data.stderrTruncated && (
            <div className="mt-1 text-[10px] text-palmkit-elements-icon-warning">
              Output truncated from {data.stderrOriginalLength?.toLocaleString()} chars
            </div>
          )}
        </>
      )}

      {!hasStdout && !hasStderr && (
        <div className="text-xs text-palmkit-elements-textSecondary italic p-4 text-center">
          Command produced no output.
        </div>
      )}
    </div>
  );
}

export const RunShellRenderer = memo(RunShellRendererImpl);
