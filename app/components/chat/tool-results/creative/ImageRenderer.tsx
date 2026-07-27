/**
 * ImageRenderer
 * =============
 * Renders the result of the `generate_image` tool.
 *
 * The tool returns either:
 *   - dataUrl: base64-encoded PNG (displayed inline via <img src>)
 *   - url: hosted image URL (displayed via <img src>)
 *
 * Features:
 *   - Inline image preview (click to enlarge in modal)
 *   - Download PNG button
 *   - Copy image to clipboard
 *   - Shows prompt + size + provider metadata
 */

import { memo, useState, useCallback } from 'react';
import { ToolResultHeader } from '~/components/chat/tool-results/shared/ToolResultHeader';
import { DownloadButton } from '~/components/chat/tool-results/shared/DownloadButton';
import { CollapsibleSection } from '~/components/chat/tool-results/shared/CollapsibleSection';
import { classNames } from '~/utils/classNames';

interface ImageRendererProps {
  result: unknown;
  theme: 'light' | 'dark';
}

interface GenerateImageResult {
  ok: boolean;
  provider?: string;
  dataUrl?: string | null;
  url?: string | null;
  prompt?: string;
  size?: string;
  bytes?: number;
  transparent?: boolean;
  error?: string;
  hint?: string;
}

function ImageRendererImpl({ result, theme: _theme }: ImageRendererProps) {
  const [enlarged, setEnlarged] = useState(false);
  const [copied, setCopied] = useState(false);

  const data = result as GenerateImageResult;

  const imageUrl = data.dataUrl ?? data.url;

  const handleCopy = useCallback(async () => {
    if (!data.dataUrl) {
      return;
    }

    try {
      const response = await fetch(data.dataUrl);
      const blob = await response.blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy image:', err);
    }
  }, [data.dataUrl]);

  if (!data.ok || !imageUrl) {
    return (
      <div className="bg-palmkit-elements-background-depth-1 p-4 rounded-md">
        <ToolResultHeader
          toolName="generate_image"
          label="Generated Image"
          iconClass="i-ph:image"
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
        toolName="generate_image"
        label="Generated Image"
        iconClass="i-ph:image"
        success
        accentColor="bg-pink-500/10"
        meta={
          <>
            {data.provider && (
              <span className="text-xs text-palmkit-elements-textSecondary uppercase">{data.provider}</span>
            )}
            {data.size && <span className="text-xs text-palmkit-elements-textSecondary">{data.size}</span>}
            {data.bytes && (
              <span className="text-xs text-palmkit-elements-textSecondary">{(data.bytes / 1024).toFixed(1)} KB</span>
            )}
          </>
        }
      />

      <div className="flex flex-wrap gap-2 mb-3">
        <DownloadButton
          data={data.dataUrl ?? undefined}
          filename={`generated-image-${Date.now()}.png`}
          mimeType="image/png"
          label="Download PNG"
          iconClass="i-ph:download-simple"
          disabled={!data.dataUrl}
        />
        <button
          onClick={handleCopy}
          disabled={!data.dataUrl}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-palmkit-elements-button-neutral-background hover:bg-palmkit-elements-button-neutral-backgroundHover text-palmkit-elements-button-neutral-text border border-palmkit-elements-borderColor disabled:opacity-50"
        >
          <div className={classNames('text-base', copied ? 'i-ph:check' : 'i-ph:copy')} />
          {copied ? 'Copied!' : 'Copy to clipboard'}
        </button>
        <button
          onClick={() => setEnlarged(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-palmkit-elements-button-neutral-background hover:bg-palmkit-elements-button-neutral-backgroundHover text-palmkit-elements-button-neutral-text border border-palmkit-elements-borderColor"
        >
          <div className="i-ph:arrows-out-simple text-base" />
          Enlarge
        </button>
      </div>

      <div
        className="relative cursor-zoom-in border border-palmkit-elements-borderColor rounded-md overflow-hidden bg-palmkit-elements-background-depth-2"
        onClick={() => setEnlarged(true)}
        style={{ maxHeight: '500px' }}
      >
        <img
          src={imageUrl}
          alt={data.prompt ?? 'Generated image'}
          className="w-full h-auto object-contain max-h-[500px]"
          loading="lazy"
        />
        <div className="absolute bottom-2 right-2 px-2 py-1 rounded text-[10px] bg-black/50 text-white opacity-0 hover:opacity-100 transition-opacity">
          Click to enlarge
        </div>
      </div>

      <div className="mt-3">
        <CollapsibleSection title="Generation details">
          <dl className="text-xs space-y-1">
            {data.prompt && (
              <div>
                <dt className="text-palmkit-elements-textSecondary font-medium">Prompt:</dt>
                <dd className="text-palmkit-elements-textPrimary mt-0.5 mb-2 italic">{data.prompt}</dd>
              </div>
            )}
            {data.provider && (
              <div className="flex justify-between">
                <dt className="text-palmkit-elements-textSecondary">Provider:</dt>
                <dd className="text-palmkit-elements-textPrimary uppercase">{data.provider}</dd>
              </div>
            )}
            {data.size && (
              <div className="flex justify-between">
                <dt className="text-palmkit-elements-textSecondary">Size:</dt>
                <dd className="text-palmkit-elements-textPrimary">{data.size}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-palmkit-elements-textSecondary">Transparent:</dt>
              <dd className="text-palmkit-elements-textPrimary">{data.transparent ? 'Yes' : 'No'}</dd>
            </div>
          </dl>
        </CollapsibleSection>
      </div>

      {/* Enlarged modal */}
      {enlarged && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 cursor-zoom-out"
          onClick={() => setEnlarged(false)}
        >
          <img src={imageUrl} alt={data.prompt ?? 'Generated image'} className="max-w-full max-h-full object-contain" />
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

export const ImageRenderer = memo(ImageRendererImpl);
