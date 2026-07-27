/**
 * ScrapePageRenderer
 * =================
 * Renders the result of the `scrape_page` tool.
 *
 * Shows structured data: title, metadata, headings, content, links,
 * images, tables. Each section is collapsible.
 */

import { memo } from 'react';
import { ToolResultHeader } from '~/components/chat/tool-results/shared/ToolResultHeader';
import { CollapsibleSection } from '~/components/chat/tool-results/shared/CollapsibleSection';

interface ScrapePageRendererProps {
  result: unknown;
  theme: 'light' | 'dark';
}

interface ScrapeLink {
  text: string;
  url: string;
  rel?: string;
}

interface ScrapeImage {
  src: string;
  alt: string;
  width?: number;
  height?: number;
}

interface ScrapeTable {
  caption?: string;
  rows: string[][];
}

interface ScrapeCodeBlock {
  language?: string;
  code: string;
}

interface ScrapeList {
  type: 'ul' | 'ol';
  items: string[];
}

interface ScrapePageResult {
  ok: boolean;
  url?: string;
  title?: string;
  metadata?: Record<string, string>;
  headings?: Array<{ level: number; text: string }>;
  content?: string;
  contentLength?: number;
  contentTruncated?: boolean;
  links?: ScrapeLink[];
  images?: ScrapeImage[];
  tables?: ScrapeTable[];
  codeBlocks?: ScrapeCodeBlock[];
  lists?: ScrapeList[];
  fetchedAt?: string;
  durationMs?: number;
  error?: string;
  hint?: string;
}

function ScrapePageRendererImpl({ result, theme: _theme }: ScrapePageRendererProps) {
  const data = result as ScrapePageResult;

  if (!data.ok) {
    return (
      <div className="bg-palmkit-elements-background-depth-1 p-4 rounded-md">
        <ToolResultHeader
          toolName="scrape_page"
          label="Page Scraper"
          iconClass="i-ph:globe"
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
        toolName="scrape_page"
        label={data.title ?? data.url ?? 'Page Scraper'}
        iconClass="i-ph:globe"
        success
        accentColor="bg-indigo-500/10"
        meta={
          <>
            {data.durationMs !== undefined && (
              <span className="text-xs text-palmkit-elements-textSecondary">{data.durationMs}ms</span>
            )}
            {data.contentLength !== undefined && (
              <span className="text-xs text-palmkit-elements-textSecondary">
                {(data.contentLength / 1024).toFixed(1)} KB
              </span>
            )}
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
            defaultExpanded
          >
            <pre className="text-xs bg-[#FAFAFA] dark:bg-[#0A0A0A] p-3 rounded-md overflow-auto max-h-96 whitespace-pre-wrap break-words">
              {data.content}
            </pre>
            {data.contentTruncated && (
              <div className="text-xs text-palmkit-elements-icon-warning mt-2 italic">
                Content was truncated to fit context window.
              </div>
            )}
          </CollapsibleSection>
        </div>
      )}

      {data.headings && data.headings.length > 0 && (
        <div className="mb-3">
          <CollapsibleSection title="Headings" badge={`${data.headings.length}`}>
            <ul className="space-y-1">
              {data.headings.map((h, idx) => (
                <li
                  key={idx}
                  className="text-xs flex items-center gap-2"
                  style={{ paddingLeft: `${(h.level - 1) * 12}px` }}
                >
                  <span className="text-palmkit-elements-textSecondary font-mono">H{h.level}</span>
                  <span className="text-palmkit-elements-textPrimary">{h.text}</span>
                </li>
              ))}
            </ul>
          </CollapsibleSection>
        </div>
      )}

      {data.links && data.links.length > 0 && (
        <div className="mb-3">
          <CollapsibleSection title="Links" badge={`${data.links.length}`}>
            <ul className="space-y-1">
              {data.links.slice(0, 20).map((link, idx) => (
                <li key={idx} className="text-xs">
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-palmkit-elements-item-contentAccent hover:underline break-all"
                  >
                    {link.text || link.url}
                  </a>
                  {link.rel && (
                    <span className="text-[10px] text-palmkit-elements-textSecondary ml-2">({link.rel})</span>
                  )}
                </li>
              ))}
              {data.links.length > 20 && (
                <li className="text-xs text-palmkit-elements-textSecondary italic">
                  ... and {data.links.length - 20} more
                </li>
              )}
            </ul>
          </CollapsibleSection>
        </div>
      )}

      {data.images && data.images.length > 0 && (
        <div className="mb-3">
          <CollapsibleSection title="Images" badge={`${data.images.length}`}>
            <div className="grid grid-cols-2 gap-2">
              {data.images.slice(0, 6).map((img, idx) => (
                <div key={idx} className="border border-palmkit-elements-borderColor rounded-md p-2">
                  <img
                    src={img.src}
                    alt={img.alt}
                    className="w-full h-24 object-cover rounded mb-1"
                    loading="lazy"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                  <div className="text-[10px] text-palmkit-elements-textSecondary truncate">
                    {img.alt || '(no alt)'}
                  </div>
                  {(img.width || img.height) && (
                    <div className="text-[10px] text-palmkit-elements-textSecondary">
                      {img.width}×{img.height}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CollapsibleSection>
        </div>
      )}

      {data.tables && data.tables.length > 0 && (
        <div className="mb-3">
          <CollapsibleSection title="Tables" badge={`${data.tables.length}`}>
            <div className="space-y-3">
              {data.tables.map((table, idx) => (
                <div key={idx} className="border border-palmkit-elements-borderColor rounded-md overflow-auto max-h-60">
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

      {data.codeBlocks && data.codeBlocks.length > 0 && (
        <div className="mb-3">
          <CollapsibleSection title="Code blocks" badge={`${data.codeBlocks.length}`}>
            <div className="space-y-2">
              {data.codeBlocks.map((block, idx) => (
                <div key={idx} className="border border-palmkit-elements-borderColor rounded-md overflow-hidden">
                  {block.language && (
                    <div className="text-[10px] text-palmkit-elements-textSecondary px-2 py-1 bg-palmkit-elements-background-depth-2 uppercase">
                      {block.language}
                    </div>
                  )}
                  <pre className="text-xs bg-[#0A0A0A] text-white p-2 overflow-auto max-h-40">{block.code}</pre>
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
                .slice(0, 15)
                .map(([key, value]) => (
                  <div key={key} className="flex gap-2">
                    <dt className="text-palmkit-elements-textSecondary font-mono min-w-0">{key}:</dt>
                    <dd className="text-palmkit-elements-textPrimary truncate">{value}</dd>
                  </div>
                ))}
              {Object.keys(data.metadata).length > 15 && (
                <div className="text-xs text-palmkit-elements-textSecondary italic">
                  ... and {Object.keys(data.metadata).length - 15} more
                </div>
              )}
            </dl>
          </CollapsibleSection>
        </div>
      )}
    </div>
  );
}

export const ScrapePageRenderer = memo(ScrapePageRendererImpl);
