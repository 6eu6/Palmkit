/**
 * Image — AI-generated image display
 * ===================================
 *
 * Displays AI-generated images from base64 encoded data.
 * Designed to work with the AI SDK's Experimental_GeneratedImage type.
 *
 * <Image src="data:image/png;base64,..." alt="Generated sunset" />
 *
 * Monochrome: no colored borders or badges. Just the image with a
 * subtle border and optional alt text below.
 */

import { memo, useState } from 'react';
import { classNames } from '~/utils/classNames';

interface ImageProps {
  src: string;
  alt?: string;
  className?: string;

  /** Show alt text below the image. Default: true. */
  showCaption?: boolean;

  /** Max height in pixels. Default: 400. */
  maxHeight?: number;
}

function ImageImpl({ src, alt = '', className, showCaption = true, maxHeight = 400 }: ImageProps) {
  const [enlarged, setEnlarged] = useState(false);
  const [loaded, setLoaded] = useState(false);

  return (
    <>
      <div className={classNames('inline-block', className)}>
        <div
          className="relative rounded-md border border-palmkit-elements-borderColor overflow-hidden cursor-zoom-in bg-palmkit-elements-background-depth-2"
          onClick={() => setEnlarged(true)}
          style={{ maxHeight: `${maxHeight}px` }}
        >
          {!loaded && <div className="absolute inset-0 ai-shimmer-bg" style={{ minHeight: '100px' }} />}
          <img
            src={src}
            alt={alt}
            className="block max-w-full h-auto"
            loading="lazy"
            onLoad={() => setLoaded(true)}
            style={{ maxHeight: `${maxHeight}px`, opacity: loaded ? 1 : 0, transition: 'opacity 0.3s' }}
          />
        </div>
        {showCaption && alt && <div className="text-xs text-palmkit-elements-textSecondary mt-1">{alt}</div>}
      </div>

      {/* Enlarged modal */}
      {enlarged && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 cursor-zoom-out"
          onClick={() => setEnlarged(false)}
        >
          <img src={src} alt={alt} className="max-w-full max-h-full object-contain" />
          <button
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-palmkit-elements-textSecondary"
            onClick={() => setEnlarged(false)}
          >
            <div className="i-ph:x text-xl" />
          </button>
        </div>
      )}
    </>
  );
}

export const Image = memo(ImageImpl);
