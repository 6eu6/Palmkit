/**
 * StreamIcon — renders a Phosphor icon by name from the StreamIcon union.
 *
 * Uses UnoCSS preset-icons (i-ph:*), which lazy-loads SVG from
 * @iconify-json/ph. No external dependency, no FOUT, works in SSR.
 *
 * For custom-branded icons (palmkit:* collection defined in uno.config.ts),
 * add a separate component — this one is for Phosphor only.
 */

import { memo } from 'react';
import type { StreamIcon as StreamIconName } from '~/lib/stream/types';

export interface StreamIconProps {
  name: StreamIconName;
  className?: string;
  size?: number;
}

/**
 * Mapping table — converts StreamIcon names to UnoCSS class names.
 * We use this instead of template literals to keep the static analyzer
 * happy (UnoCSS scans for literal strings).
 */
const ICON_CLASSES: Record<StreamIconName, string> = {
  'ph:brain-duotone': 'i-ph:brain-duotone',
  'ph:file-text-duotone': 'i-ph:file-text-duotone',
  'ph:magnifying-glass-duotone': 'i-ph:magnifying-glass-duotone',
  'ph:list-duotone': 'i-ph:list-duotone',
  'ph:terminal-window-duotone': 'i-ph:terminal-window-duotone',
  'ph:flask-duotone': 'i-ph:flask-duotone',
  'ph:camera-duotone': 'i-ph:camera-duotone',
  'ph:upload-simple-duotone': 'i-ph:upload-simple-duotone',
  'ph:lightning-duotone': 'i-ph:lightning-duotone',
  'ph:hammer-duotone': 'i-ph:hammer-duotone',
  'ph:check-circle-duotone': 'i-ph:check-circle-duotone',
  'ph:warning-circle-duotone': 'i-ph:warning-circle-duotone',
  'ph:x-circle-duotone': 'i-ph:x-circle-duotone',
  'ph:spinner-duotone': 'i-ph:spinner-duotone',
  'ph:chat-circle-text-duotone': 'i-ph:chat-circle-text-duotone',
  'ph:gear-duotone': 'i-ph:gear-duotone',
  'ph:stop-duotone': 'i-ph:stop-duotone',
  'ph:pencil-simple-duotone': 'i-ph:pencil-simple-duotone',
  'ph:sparkle-duotone': 'i-ph:sparkle-duotone',
  'ph:plugs-connected-duotone': 'i-ph:plugs-connected-duotone',
};

function StreamIconImpl({ name, className = '', size = 16 }: StreamIconProps) {
  const iconClass = ICON_CLASSES[name];
  const sizeStyle = size ? { width: `${size}px`, height: `${size}px` } : undefined;

  return <span className={`${iconClass} inline-block shrink-0 ${className}`} style={sizeStyle} aria-hidden="true" />;
}

export const StreamIcon = memo(StreamIconImpl);

/**
 * Severity → color mapping, used by activity entries.
 * Uses the existing palmkit-elements-* theme tokens.
 */
export function severityToClass(severity: 'info' | 'success' | 'warning' | 'error'): string {
  switch (severity) {
    case 'success':
      return 'text-palmkit-elements-button-success-text';
    case 'warning':
      return 'text-palmkit-elements-button-warning-text';
    case 'error':
      return 'text-palmkit-elements-button-danger-text';
    case 'info':
    default:
      return 'text-palmkit-elements-textSecondary';
  }
}
