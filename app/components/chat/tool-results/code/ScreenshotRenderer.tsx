/**
 * ScreenshotRenderer
 * =================
 * Renders the result of the `screenshot` tool.
 *
 * The tool returns metadata (URL, dimensions, size) but NOT the base64
 * image. The frontend fetches the image from the sandbox URL and
 * displays it.
 *
 * Features:
 *   - Inline preview
 *   - Click to enlarge (modal)
 *   - Download PNG (fetches from sandbox URL)
 *   - Shows dimensions + size
 */

import { memo, useState } from 'react';
import { ToolResultHeader } from '~/components/chat/tool-results/shared/ToolResultHeader';
import { CollapsibleSection } from '~/components/chat/tool-results/shared/CollapsibleSection';

interface ScreenshotRendererProps {
  result: unknown;
  theme: 'light' | 'dark';
}

interface ScreenshotResult {
  ok: boolean;
  url?: string;
  mimeType?: string;
  size?: number;
  width?: number;
  height?: number;
  captured?: boolean;
  note?: string;
  error?: string;
  hint?: string;
}

function ScreenshotRendererImpl({ result, theme: _theme }: ScreenshotRendererProps) {
  const [enlarged, setEnlarged] = useState(false);

  const data = result as ScreenshotResult;

  if (!data.ok) {
    return (
      <div className="bg-palmkit-elements-background-depth-1 p-4 rounded-md">
        <ToolResultHeader
          toolName="screenshot"
          label="Screenshot"
          iconClass="i-ph:camera"
          success={false}
          error={data.error}
        />
        {data.hint && <div className="mt-2 text-xs text-palmkit-elements-textSecondary">{data.hint}</div>}
      </div>
    );
  }

  const handleDownload = async () => {
    if (!data.url) {
      return;
    }

    try {
      const response = await fetch(data.url);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `screenshot-${Date.now()}.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      console.error('Download failed:', err);
    }
  };

  return (
    <div className="bg-palmkit-elements-background-depth-1 p-4 rounded-md">
      <ToolResultHeader
        toolName="screenshot"
        label="Screenshot"
        iconClass="i-ph:camera"
        success
        accentColor="bg-rose-500/10"
        meta={
          <>
            {data.width && data.height && (
              <span className="text-xs text-palmkit-elements-textSecondary">
                {data.width}×{data.height}
              </span>
            )}
            {data.size !== undefined && (
              <span className="text-xs text-palmkit-elements-textSecondary">{(data.size / 1024).toFixed(1)} KB</span>
            )}
          </>
        }
      />

      <div className="flex flex-wrap gap-2 mb-3">
        <button
          onClick={handleDownload}
          disabled={!data.url}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-palmkit-elements-button-primary-background hover:bg-palmkit-elements-button-primary-backgroundHover text-palmkit-elements-button-primary-text disabled:opacity-50"
        >
          <div className="i-ph:download-simple text-base" />
          Download PNG
        </button>
        <button
          onClick={() => setEnlarged(true)}
          disabled={!data.url}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-palmkit-elements-button-neutral-background hover:bg-palmkit-elements-button-neutral-backgroundHover text-palmkit-elements-button-neutral-text border border-palmkit-elements-borderColor disabled:opacity-50"
        >
          <div className="i-ph:arrows-out-simple text-base" />
          Enlarge
        </button>
      </div>

      {data.url ? (
        <div
          className="relative cursor-zoom-in border border-palmkit-elements-borderColor rounded-md overflow-hidden bg-palmkit-elements-background-depth-2"
          onClick={() => setEnlarged(true)}
        >
          <img
            src={data.url}
            alt={`Screenshot of ${data.url}`}
            className="w-full h-auto object-contain max-h-[500px]"
            loading="lazy"
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              target.style.display = 'none';
              target.parentElement!.innerHTML =
                '<div class="p-8 text-center text-xs text-palmkit-elements-textSecondary">Failed to load screenshot. The dev server may not be running.</div>';
            }}
          />
        </div>
      ) : (
        <div className="border border-palmkit-elements-borderColor rounded-md p-8 text-center text-xs text-palmkit-elements-textSecondary">
          No screenshot URL in result.
        </div>
      )}

      {data.note && (
        <div className="mt-3">
          <CollapsibleSection title="Notes">
            <p className="text-xs text-palmkit-elements-textSecondary">{data.note}</p>
          </CollapsibleSection>
        </div>
      )}

      {enlarged && data.url && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 cursor-zoom-out"
          onClick={() => setEnlarged(false)}
        >
          <img src={data.url} alt="Screenshot (enlarged)" className="max-w-full max-h-full object-contain" />
          <button
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white"
            onClick={() => setEnlarged(false)}
          >
            <div className="i-ph:x text-xl" />
          </button>
        </div>
      )}
    </div>
  );
}

export const ScreenshotRenderer = memo(ScreenshotRendererImpl);
