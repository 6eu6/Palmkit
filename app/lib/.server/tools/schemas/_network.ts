/**
 * Network helpers — CF Workers compatible
 * =======================================
 *
 * Cloudflare Workers do NOT support AbortSignal.timeout() (it requires
 * Node 17+ and is not in the Workers runtime). This module wraps fetch
 * with a manual AbortController-based timeout.
 *
 * Every fetch in the tools layer MUST go through fetchWithTimeout to
 * guarantee bounded execution. Tools that call fetch directly will
 * hang indefinitely on slow origins — a top cause of stuck streams.
 */

export interface FetchOptions extends RequestInit {
  /** Timeout in ms. Default 10000. */
  timeoutMs?: number;

  /** Custom User-Agent. Default Palmkit-Agent/1.0. */
  userAgent?: string;
}

/**
 * fetch with timeout. Throws an Error with `name='AbortTimeoutError'`
 * when the timeout elapses, so callers can distinguish timeout from
 * network errors.
 */
export async function fetchWithTimeout(url: string, options: FetchOptions = {}): Promise<Response> {
  const { timeoutMs = 10000, userAgent = 'Palmkit-Agent/1.0', headers, ...rest } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // Combine caller-provided headers with our defaults.
  const mergedHeaders = new Headers(headers);

  if (!mergedHeaders.has('User-Agent')) {
    mergedHeaders.set('User-Agent', userAgent);
  }

  // Some hosts block requests without an Accept header.
  if (!mergedHeaders.has('Accept')) {
    mergedHeaders.set('Accept', 'text/html,application/xhtml+xml,application/json,*/*;q=0.8');
  }

  try {
    const response = await fetch(url, {
      ...rest,
      headers: mergedHeaders,
      signal: controller.signal,
    });
    return response;
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      const timeoutError = new Error(`Request timed out after ${timeoutMs}ms`);
      timeoutError.name = 'AbortTimeoutError';
      throw timeoutError;
    }

    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Decode common HTML entities to plain text.
 * Used by every HTML extraction tool — kept here so all tools share
 * the same decoding behavior.
 */
export function decodeHtmlEntities(input: string): string {
  if (!input) {
    return input;
  }

  // Order matters: &amp; must be last to avoid double-decoding.
  const entities: Array<[RegExp, string]> = [
    [/&nbsp;/g, ' '],
    [/&quot;/g, '"'],
    [/&#39;/g, "'"],
    [/&apos;/g, "'"],
    [/&lt;/g, '<'],
    [/&gt;/g, '>'],
    [/&amp;/g, '&'],
  ];

  let result = input;

  for (const [pattern, replacement] of entities) {
    result = result.replace(pattern, replacement);
  }

  // Numeric entities: &#123; (decimal) or &#x7B; (hex)
  result = result.replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)));
  result = result.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

  return result;
}

/**
 * Strip HTML tags from a string, preserving text content.
 * Used by read_url (text mode) and as a fallback when readability
 * extraction fails.
 */
export function stripHtmlTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<form[\s\S]*?<\/form>/gi, '')
    .replace(/<\/?(p|div|br|h[1-6]|li|ul|ol|pre|code|blockquote|tr|td|th)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/**
 * Resolve a possibly-relative URL against a base URL.
 * Returns the original string if resolution fails (so callers don't crash).
 *
 * Example:
 *   resolveUrl('/about', 'https://example.com/') → 'https://example.com/about'
 *   resolveUrl('//cdn.com/x.png', 'https://example.com/') → 'https://cdn.com/x.png'
 */
export function resolveUrl(maybeRelative: string, baseUrl: string): string {
  if (!maybeRelative) {
    return maybeRelative;
  }

  // Already absolute
  if (/^https?:\/\//i.test(maybeRelative)) {
    return maybeRelative;
  }

  // Protocol-relative
  if (maybeRelative.startsWith('//')) {
    const proto = baseUrl.match(/^(https?:)/i)?.[1] ?? 'https:';
    return `${proto}${maybeRelative}`;
  }

  try {
    return new URL(maybeRelative, baseUrl).href;
  } catch {
    return maybeRelative;
  }
}

/**
 * Truncate a string to `max` characters, appending a marker if truncated.
 */
export function truncateWithMarker(
  input: string,
  max: number,
): { text: string; truncated: boolean; originalLength: number } {
  if (input.length <= max) {
    return { text: input, truncated: false, originalLength: input.length };
  }

  return {
    text: input.slice(0, max) + '\n\n[... truncated]',
    truncated: true,
    originalLength: input.length,
  };
}
