/**
 * ListFilesRenderer
 * =================
 * Renders the result of the `list_files` tool.
 *
 * Shows: file count, total size, extension breakdown, and a tree-like
 * view of all files with size + line count.
 */

import { memo, useMemo } from 'react';
import { ToolResultHeader } from '~/components/chat/tool-results/shared/ToolResultHeader';
import { classNames } from '~/utils/classNames';

interface ListFilesRendererProps {
  result: unknown;
  theme: 'light' | 'dark';
}

interface FileEntry {
  path: string;
  size: number;
  lines: number;
}

interface ListFilesResult {
  ok: boolean;
  totalFiles?: number;
  totalSize?: number;
  totalLines?: number;
  byExtension?: Record<string, number>;
  files?: FileEntry[];
  error?: string;
  hint?: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function fileIcon(path: string): string {
  const ext = path.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  const iconMap: Record<string, string> = {
    ts: 'i-ph:file-code',
    tsx: 'i-ph:file-code',
    js: 'i-ph:file-code',
    jsx: 'i-ph:file-code',
    json: 'i-ph:brackets-curly',
    md: 'i-ph:article',
    html: 'i-ph:file-html',
    css: 'i-ph:file-css',
    scss: 'i-ph:file-css',
    py: 'i-ph:file-code',
    png: 'i-ph:image',
    jpg: 'i-ph:image',
    jpeg: 'i-ph:image',
    svg: 'i-ph:image',
    pdf: 'i-ph:file-pdf',
  };

  return iconMap[ext ?? ''] ?? 'i-ph:file';
}

function ListFilesRendererImpl({ result, theme: _theme }: ListFilesRendererProps) {
  const data = result as ListFilesResult;

  // Group files by directory for tree view
  const tree = useMemo(() => {
    if (!data.files) {
      return null;
    }

    const groups: Record<string, FileEntry[]> = {};

    for (const file of data.files) {
      const lastSlash = file.path.lastIndexOf('/');
      const dir = lastSlash >= 0 ? file.path.slice(0, lastSlash) : '(root)';

      if (!groups[dir]) {
        groups[dir] = [];
      }

      groups[dir].push(file);
    }

    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [data.files]);

  if (!data.ok) {
    return (
      <div className="bg-palmkit-elements-background-depth-1 p-4 rounded-md">
        <ToolResultHeader
          toolName="list_files"
          label="File Listing"
          iconClass="i-ph:folder-open"
          success={false}
          error={data.error}
        />
      </div>
    );
  }

  return (
    <div className="bg-palmkit-elements-background-depth-1 p-4 rounded-md">
      <ToolResultHeader
        toolName="list_files"
        label="Project Files"
        iconClass="i-ph:folder-open"
        success
        accentColor="bg-amber-500/10"
        meta={
          <>
            {data.totalFiles !== undefined && (
              <span className="text-xs text-palmkit-elements-textSecondary">
                {data.totalFiles} file{data.totalFiles !== 1 ? 's' : ''}
              </span>
            )}
            {data.totalSize !== undefined && (
              <span className="text-xs text-palmkit-elements-textSecondary">{formatBytes(data.totalSize)}</span>
            )}
            {data.totalLines !== undefined && (
              <span className="text-xs text-palmkit-elements-textSecondary">
                {data.totalLines.toLocaleString()} lines
              </span>
            )}
          </>
        }
      />

      {data.byExtension && Object.keys(data.byExtension).length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {Object.entries(data.byExtension)
            .sort(([, a], [, b]) => b - a)
            .map(([ext, count]) => (
              <span
                key={ext}
                className="px-2 py-0.5 rounded text-[10px] font-mono bg-palmkit-elements-background-depth-2 text-palmkit-elements-textSecondary"
              >
                .{ext}: {count}
              </span>
            ))}
        </div>
      )}

      {tree && (
        <div className="border border-palmkit-elements-borderColor rounded-md overflow-auto max-h-96">
          {tree.map(([dir, files]) => (
            <div key={dir}>
              <div className="px-2 py-1 bg-palmkit-elements-background-depth-2 text-xs font-medium text-palmkit-elements-textSecondary sticky top-0">
                <div className="i-ph:folder inline-block mr-1" />
                {dir}/
              </div>
              {files.map((file) => (
                <div
                  key={file.path}
                  className="flex items-center gap-2 px-3 py-1 hover:bg-palmkit-elements-background-depth-2 text-xs"
                >
                  <div className={classNames('text-sm text-palmkit-elements-textSecondary', fileIcon(file.path))} />
                  <span className="text-palmkit-elements-textPrimary flex-1 truncate font-mono">
                    {file.path.slice(file.path.lastIndexOf('/') + 1)}
                  </span>
                  <span className="text-palmkit-elements-textSecondary whitespace-nowrap">
                    {formatBytes(file.size)}
                  </span>
                  <span className="text-palmkit-elements-textSecondary whitespace-nowrap">{file.lines}L</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {!tree && (
        <div className="text-xs text-palmkit-elements-textSecondary italic p-4 text-center">No files in project.</div>
      )}
    </div>
  );
}

export const ListFilesRenderer = memo(ListFilesRendererImpl);
