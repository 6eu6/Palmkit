/**
 * ReadSandboxFileRenderer
 * ======================
 * Renders the result of the `read_sandbox_file` tool.
 *
 * Similar to ReadFileRenderer but with a "sandbox" indicator and
 * truncation warning when the file was capped.
 */

import { memo, useState } from 'react';
import { ToolResultHeader } from '~/components/chat/tool-results/shared/ToolResultHeader';

interface ReadSandboxFileRendererProps {
  result: unknown;
  theme: 'light' | 'dark';
}

interface ReadSandboxFileResult {
  ok: boolean;
  path?: string;
  content?: string;
  size?: number;
  truncated?: boolean;
  originalLength?: number;
  error?: string;
  hint?: string;
}

function detectLanguage(path: string): string {
  const ext = path.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  const langMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'tsx',
    js: 'javascript',
    jsx: 'jsx',
    py: 'python',
    rb: 'ruby',
    go: 'go',
    rs: 'rust',
    java: 'java',
    c: 'c',
    cpp: 'cpp',
    h: 'c',
    sh: 'bash',
    yml: 'yaml',
    yaml: 'yaml',
    json: 'json',
    md: 'markdown',
    html: 'html',
    css: 'css',
    scss: 'scss',
    sql: 'sql',
    xml: 'xml',
  };

  return langMap[ext ?? ''] ?? 'text';
}

function ReadSandboxFileRendererImpl({ result, theme: _theme }: ReadSandboxFileRendererProps) {
  const [showLineNumbers, setShowLineNumbers] = useState(true);

  const data = result as ReadSandboxFileResult;

  if (!data.ok) {
    return (
      <div className="bg-palmkit-elements-background-depth-1 p-4 rounded-md">
        <ToolResultHeader
          toolName="read_sandbox_file"
          label="Sandbox File Reader"
          iconClass="i-ph:file-search"
          success={false}
          error={data.error}
        />
        {data.hint && <div className="mt-2 text-xs text-palmkit-elements-textSecondary">{data.hint}</div>}
      </div>
    );
  }

  const language = detectLanguage(data.path ?? '');
  const content = data.content ?? '';
  const lines = content.split('\n');

  return (
    <div className="bg-palmkit-elements-background-depth-1 p-4 rounded-md">
      <ToolResultHeader
        toolName="read_sandbox_file"
        label={data.path ?? 'Sandbox File'}
        iconClass="i-ph:file-search"
        success
        accentColor="bg-sky-500/10"
        meta={
          <>
            <span className="text-xs text-palmkit-elements-textSecondary uppercase font-mono">{language}</span>
            {data.size !== undefined && (
              <span className="text-xs text-palmkit-elements-textSecondary">{(data.size / 1024).toFixed(1)} KB</span>
            )}
            {data.originalLength !== undefined && (
              <span className="text-xs text-palmkit-elements-textSecondary">
                {data.originalLength.toLocaleString()} chars
              </span>
            )}
          </>
        }
      />

      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-palmkit-elements-item-contentAccent/10 text-palmkit-elements-item-contentAccent font-medium uppercase">
          Sandbox file
        </span>
        <button
          onClick={() => setShowLineNumbers(!showLineNumbers)}
          className="text-xs text-palmkit-elements-textSecondary hover:text-palmkit-elements-textPrimary"
        >
          {showLineNumbers ? 'Hide' : 'Show'} line numbers
        </button>
      </div>

      {data.truncated && (
        <div className="mb-2 p-2 rounded-md bg-palmkit-elements-icon-warning/10 text-xs text-palmkit-elements-textSecondary">
          <div className="i-ph:warning inline-block mr-1" />
          Content truncated from {data.originalLength?.toLocaleString()} chars.
        </div>
      )}

      <div className="border border-palmkit-elements-borderColor rounded-md overflow-auto max-h-96 bg-[#FAFAFA] dark:bg-[#0A0A0A]">
        <table className="w-full text-xs font-mono">
          <tbody>
            {lines.map((line, idx) => (
              <tr key={idx} className="hover:bg-palmkit-elements-background-depth-2">
                {showLineNumbers && (
                  <td className="px-2 py-0.5 text-right text-palmkit-elements-textSecondary select-none border-r border-palmkit-elements-borderColor sticky left-0 bg-[#FAFAFA] dark:bg-[#0A0A0A]">
                    {idx + 1}
                  </td>
                )}
                <td className="px-3 py-0.5 text-palmkit-elements-textPrimary whitespace-pre">{line || ' '}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export const ReadSandboxFileRenderer = memo(ReadSandboxFileRendererImpl);
