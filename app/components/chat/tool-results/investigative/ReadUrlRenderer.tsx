/**
 * ReadUrlRenderer
 * ===============
 * Renders the result of the `read_url` tool.
 *
 * Shows: URL, format, content length, content type, and the content
 * itself (text/markdown/JSON).
 */

import { memo, useState } from 'react';
import { ToolResultHeader } from '~/components/chat/tool-results/shared/ToolResultHeader';
import { CollapsibleSection } from '~/components/chat/tool-results/shared/CollapsibleSection';

interface ReadUrlRendererProps {
  result: unknown;
  theme: 'light' | 'dark';
}

interface ReadUrlResult {
  ok: boolean;
  url?: string;
  contentType?: string;
  format?: string;
  content?: string;
  truncated?: boolean;
  originalLength?: number;
  error?: string;
  hint?: string;
}

function ReadUrlRendererImpl({ result, theme: _theme }: ReadUrlRendererProps) {
  const [expanded, setExpanded] = useState(false);

  const data = result as ReadUrlResult;

  if (!data.ok) {
    return (
      <div className="bg-palmkit-elements-background-depth-1 p-4 rounded-md">
        <ToolResultHeader
          toolName="read_url"
          label="URL Reader"
          iconClass="i-ph:link"
          success={false}
          error={data.error}
        />
        {data.hint && (
          <div className="mt-2 p-2 rounded-md bg-palmkit-elements-icon-warning/10 text-xs text-palmkit-elements-textSecondary">
            <div className="i-ph:info inline-block mr-1" />
            {data.hint}
          </div>
        )}
      </div>
    );
  }

  const previewLength = 2000;
  const showPreview = !expanded && (data.content?.length ?? 0) > previewLength;
  const displayContent = showPreview ? (data.content ?? '').slice(0, previewLength) : data.content;

  return (
    <div className="bg-palmkit-elements-background-depth-1 p-4 rounded-md">
      <ToolResultHeader
        toolName="read_url"
        label={data.url ?? 'URL Reader'}
        iconClass="i-ph:link"
        success
        accentColor="bg-teal-500/10"
        meta={
          <>
            {data.format && (
              <span className="text-xs text-palmkit-elements-textSecondary uppercase">{data.format}</span>
            )}
            {data.originalLength !== undefined && (
              <span className="text-xs text-palmkit-elements-textSecondary">
                {data.originalLength.toLocaleString()} chars
              </span>
            )}
            {data.truncated && <span className="text-xs text-palmkit-elements-icon-warning">truncated</span>}
          </>
        }
      />

      <a
        href={data.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1.5 text-xs text-palmkit-elements-item-contentAccent hover:underline mb-3 break-all"
      >
        <div className="i-ph:arrow-square-out" />
        {data.url}
      </a>

      <pre className="text-xs bg-[#FAFAFA] dark:bg-[#0A0A0A] p-3 rounded-md overflow-auto max-h-96 whitespace-pre-wrap break-words">
        {displayContent}
        {showPreview && (
          <span className="text-palmkit-elements-textSecondary italic">
            {'\n\n[... '}
            <button onClick={() => setExpanded(true)} className="text-palmkit-elements-item-contentAccent underline">
              show {(data.content?.length ?? 0) - previewLength} more chars
            </button>
            {' ...]'}
          </span>
        )}
      </pre>

      {data.contentType && (
        <div className="mt-3">
          <CollapsibleSection title="Metadata">
            <dl className="text-xs space-y-1">
              <div className="flex justify-between">
                <dt className="text-palmkit-elements-textSecondary">URL:</dt>
                <dd className="text-palmkit-elements-textPrimary truncate ml-2 max-w-xs font-mono">{data.url}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-palmkit-elements-textSecondary">Content-Type:</dt>
                <dd className="text-palmkit-elements-textPrimary">{data.contentType}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-palmkit-elements-textSecondary">Format:</dt>
                <dd className="text-palmkit-elements-textPrimary uppercase">{data.format}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-palmkit-elements-textSecondary">Original length:</dt>
                <dd className="text-palmkit-elements-textPrimary">
                  {data.originalLength?.toLocaleString() ?? 'N/A'} chars
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-palmkit-elements-textSecondary">Truncated:</dt>
                <dd className="text-palmkit-elements-textPrimary">{data.truncated ? 'Yes' : 'No'}</dd>
              </div>
            </dl>
          </CollapsibleSection>
        </div>
      )}
    </div>
  );
}

export const ReadUrlRenderer = memo(ReadUrlRendererImpl);
