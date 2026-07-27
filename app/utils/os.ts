/*
 * Helper to detect OS.
 *
 * NOTE: guard against `navigator.platform` being undefined, not just
 * `navigator` being undefined. Server runtimes like Cloudflare Workers /
 * workerd (used by `wrangler pages dev` and in production) DO define a
 * `navigator` global but WITHOUT a `platform` property — so the old
 * `typeof navigator !== 'undefined'` check passed and then threw
 * "Cannot read properties of undefined (reading 'toLowerCase')" at module
 * import time, crashing SSR on every request.
 */
const platform =
  typeof navigator !== 'undefined' && typeof navigator.platform === 'string' ? navigator.platform.toLowerCase() : '';

export const isMac = platform.includes('mac');
export const isWindows = platform.includes('win');
export const isLinux = platform.includes('linux');
