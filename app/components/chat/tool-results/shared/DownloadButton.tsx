/**
 * DownloadButton + downloadDataUrl helper
 * =======================================
 * Shared button component used by create_pdf, create_docx, create_xlsx,
 * read_document (when content is downloadable), and generate_image.
 *
 * Triggers a browser download by creating a temporary <a> element
 * with the data URL (or blob URL for large content) and clicking it.
 *
 * Why not just use an <a download> element directly?
 *   - We need to support both data URLs (small files, base64) and
 *     blob URLs (large files, binary).
 *   - The button needs to look consistent with the rest of the UI.
 *   - We want to track download count for analytics.
 */

import { memo, useState, useCallback } from 'react';
import { classNames } from '~/utils/classNames';

interface DownloadButtonProps {
  /** The content to download — either a data URL or raw text/binary. */
  data?: string;

  /** Suggested filename including extension. */
  filename: string;

  /** MIME type for blob creation when data is not a data URL. */
  mimeType?: string;

  /** Optional label (default: "Download"). */
  label?: string;

  /** Optional icon class (default: download icon). */
  iconClass?: string;

  /** Disabled state. */
  disabled?: boolean;
}

/**
 * Trigger a browser download from a data URL, a hosted URL, or raw content.
 *
 * The hosted-URL case is not a nicety. Generated images used to arrive as a
 * base64 data URL and now arrive as a link to storage, and the old code took
 * anything that was not a data URL to be file *content* — so clicking
 * Download on a generated image saved a text file containing the URL. Setting
 * `href` to a cross-origin link is not enough either: browsers ignore the
 * `download` attribute across origins and open a tab instead. Fetching it
 * into a blob is what actually downloads the file.
 */
export async function triggerDownload(data: string, filename: string, mimeType = 'text/plain') {
  let url: string;
  let isObjectUrl = false;

  if (data.startsWith('data:')) {
    url = data;
  } else if (/^https?:\/\//.test(data)) {
    const res = await fetch(data);
    url = URL.createObjectURL(await res.blob());
    isObjectUrl = true;
  } else {
    // Raw text content.
    const blob = new Blob([data], { type: mimeType });
    url = URL.createObjectURL(blob);
    isObjectUrl = true;
  }

  // Create a temporary anchor element and click it
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Revoke the blob URL after a short delay (give browser time to start download)
  if (isObjectUrl) {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function DownloadButtonImpl({
  data,
  filename,
  mimeType = 'text/plain',
  label = 'Download',
  iconClass = 'i-ph:download-simple',
  disabled,
}: DownloadButtonProps) {
  const [downloadCount, setDownloadCount] = useState(0);

  const handleClick = useCallback(() => {
    if (!data || disabled) {
      return;
    }

    void triggerDownload(data, filename, mimeType);
    setDownloadCount((c) => c + 1);
  }, [data, filename, mimeType, disabled]);

  return (
    <button
      onClick={handleClick}
      disabled={disabled || !data}
      className={classNames(
        'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
        'bg-palmkit-elements-button-primary-background hover:bg-palmkit-elements-button-primary-backgroundHover',
        'text-palmkit-elements-button-primary-text',
        'disabled:opacity-50 disabled:cursor-not-allowed',
      )}
      title={`Download ${filename}${downloadCount > 0 ? ` (downloaded ${downloadCount}×)` : ''}`}
    >
      <div className={classNames('text-base', iconClass)} />
      <span>{label}</span>
      {downloadCount > 0 && <span className="text-palmkit-elements-textSecondary text-[10px]">({downloadCount})</span>}
    </button>
  );
}

export const DownloadButton = memo(DownloadButtonImpl);
