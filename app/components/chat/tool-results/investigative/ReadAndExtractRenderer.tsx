/**
 * ReadAndExtractRenderer
 * =====================
 * Renders the result of the `read_and_extract` tool.
 *
 * Shows: title, keyPoints (the standout feature), content, links,
 * images, tables, metadata. Layout mirrors ScrapePageRenderer but
 * emphasizes keyPoints at the top.
 */

import { memo } from 'react';
import { ToolResultHeader } from '~/components/chat/tool-results/shared/ToolResultHeader';
import { CollapsibleSection } from '~/components/chat/tool-results/shared/CollapsibleSection';

interface ReadAndExtractRendererProps {
  result: unknown;
  theme: 'light' | 'dark';
}

interface ReadAndExtractResult {
  ok: boolean;
  url?: string;
  fetchedAt?: string;
  title?: string;
  metadata?: Record<string, string>;
  content?: string;
  contentLength?: number;
  contentTruncated?: boolean;
  keyPoints?: string[];
  links?: Array<{ text: string; url: string }>;
  images?: Array<{ src: string; alt: string }>;
  tables?: Array<{ caption?: string; rows: string[][] }>;
  error?: string;
  hint?: string;
}

function ReadAndExtractRendererImpl({ result, theme: _theme }: ReadAndExtractRendererProps) {
  const data = result as ReadAndExtractResult;

  if (!data.ok) {
    return (
      <div className="bg-palmkit-elements-background-depth-1 p-4 rounded-md">
        <ToolResultHeader
          toolName="read_and_extract"
          label="Page Extractor"
          iconClass="i-ph:scan"
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

  return (
    <div className="bg-palmkit-elements-background-depth-1 p-4 rounded-md">
      <ToolResultHeader
        toolName="read_and_extract"
        label={data.title ?? data.url ?? 'Page Extractor'}
        iconClass="i-ph:scan"
        success
        accentColor="bg-emerald-500/10"
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

      {data.keyPoints && data.keyPoints.length > 0 && (
        <div className="mb-4 p-3 rounded-md bg-palmkit-elements-background-depth-2 border-l-2 border-palmkit-elements-item-contentAccent">
          <div className="text-[10px] uppercase text-palmkit-elements-textSecondary mb-2 flex items-center gap-1">
            <div className="i-ph:lightbulb" />
            Key points (auto-extracted)
          </div>
          <ul className="space-y-1.5">
            {data.keyPoints.map((point, idx) => (
              <li key={idx} className="flex items-start gap-2 text-xs text-palmkit-elements-textPrimary">
                <span className="text-palmkit-elements-item-contentAccent mt-0.5">•</span>
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.title && (
        <div className="mb-3">
          <div className="text-[10px] uppercase text-palmkit-elements-textSecondary mb-1">Title</div>
          <div className="text-sm font-medium text-palmkit-elements-textPrimary">{data.title}</div>
        </div>
      )}

      {data.content && (
        <div className="mb-3">
          <CollapsibleSection
            title="Main content"
            badge={`${data.contentLength?.toLocaleString() ?? data.content.length} chars`}
          >
            <pre className="text-xs bg-[#FAFAFA] dark:bg-[#0A0A0A] p-3 rounded-md overflow-auto max-h-96 whitespace-pre-wrap break-words">
              {data.content}
            </pre>
            {data.contentTruncated && (
              <div className="text-xs text-palmkit-elements-icon-warning mt-2 italic">Content was truncated.</div>
            )}
          </CollapsibleSection>
        </div>
      )}

      {data.links && data.links.length > 0 && (
        <div className="mb-3">
          <CollapsibleSection title="Top links" badge={`${data.links.length}`}>
            <ul className="space-y-1">
              {data.links.map((link, idx) => (
                <li key={idx} className="text-xs">
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-palmkit-elements-item-contentAccent hover:underline break-all"
                  >
                    {link.text || link.url}
                  </a>
                </li>
              ))}
            </ul>
          </CollapsibleSection>
        </div>
      )}

      {data.images && data.images.length > 0 && (
        <div className="mb-3">
          <CollapsibleSection title="Top images" badge={`${data.images.length}`}>
            <div className="grid grid-cols-3 gap-2">
              {data.images.map((img, idx) => (
                <div key={idx} className="border border-palmkit-elements-borderColor rounded-md p-1">
                  <img
                    src={img.src}
                    alt={img.alt}
                    className="w-full h-20 object-cover rounded"
                    loading="lazy"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                  <div className="text-[10px] text-palmkit-elements-textSecondary truncate mt-1">
                    {img.alt || '(no alt)'}
                  </div>
                </div>
              ))}
            </div>
          </CollapsibleSection>
        </div>
      )}

      {data.tables && data.tables.length > 0 && (
        <div className="mb-3">
          <CollapsibleSection title="Tables" badge={`${data.tables.length}`}>
            <div className="space-y-2">
              {data.tables.map((table, idx) => (
                <div key={idx} className="border border-palmkit-elements-borderColor rounded-md overflow-auto max-h-40">
                  {table.caption && (
                    <div className="text-xs font-medium p-2 bg-palmkit-elements-background-depth-2">
                      {table.caption}
                    </div>
                  )}
                  <table className="w-full text-xs">
                    <tbody>
                      {table.rows.map((row, rowIdx) => (
                        <tr
                          key={rowIdx}
                          className={rowIdx === 0 ? 'bg-palmkit-elements-background-depth-2 font-medium' : ''}
                        >
                          {row.map((cell, cellIdx) => (
                            <td
                              key={cellIdx}
                              className="px-2 py-1 border-r border-palmkit-elements-borderColor last:border-r-0"
                            >
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </CollapsibleSection>
        </div>
      )}

      {data.metadata && Object.keys(data.metadata).length > 0 && (
        <div className="mb-3">
          <CollapsibleSection title="Metadata" badge={`${Object.keys(data.metadata).length} fields`}>
            <dl className="text-xs space-y-1">
              {Object.entries(data.metadata)
                .slice(0, 10)
                .map(([key, value]) => (
                  <div key={key} className="flex gap-2">
                    <dt className="text-palmkit-elements-textSecondary font-mono">{key}:</dt>
                    <dd className="text-palmkit-elements-textPrimary truncate">{value}</dd>
                  </div>
                ))}
            </dl>
          </CollapsibleSection>
        </div>
      )}
    </div>
  );
}

export const ReadAndExtractRenderer = memo(ReadAndExtractRendererImpl);
