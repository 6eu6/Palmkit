/**
 * File content validation — rejects corrupt file content before saving.
 *
 * Extracted from agent-tools.ts during P4 decomposition.
 *
 * GLM-4.7 has a known bug where it sometimes serializes file content as
 * JSON instead of raw source code. This catches those cases before the
 * write reaches R2.
 */

/**
 * Returns null if content is valid, or an error message string if corrupt.
 */
export function validateFileContent(path: string, content: string): string | null {
  const trimmed = content.trimStart();

  if (trimmed.length === 0) {
    return null; // empty files are valid (e.g. .gitkeep)
  }

  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const baseName = path.split('/').pop() ?? path;

  /*
   * HTML files must start with <!DOCTYPE, <html, or a comment.
   * GLM corruption produces JSON arrays/objects as HTML content.
   */
  if (ext === 'html' || ext === 'htm') {
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      return (
        `REFUSED — ${path} content starts with '[' or '{' — this looks like JSON, not HTML. ` +
        `HTML files must start with <!DOCTYPE html> or <html>. ` +
        `Re-write ${path} with actual HTML source code as a raw string.`
      );
    }
  }

  /*
   * CSS files must NOT start with [ or { — that indicates JSON corruption.
   * GLM sometimes produces [{"margin":0,...}] as CSS.
   */
  if (ext === 'css' || ext === 'scss' || ext === 'sass') {
    if (trimmed.startsWith('[')) {
      return (
        `REFUSED — ${path} content starts with '[' — this looks like a JSON array, not CSS. ` +
        `CSS files must contain actual CSS rules (e.g. "body { margin: 0; }"). ` +
        `Re-write ${path} with raw CSS source.`
      );
    }
  }

  /*
   * JSX/TSX files must NOT be valid JSON objects or arrays.
   * GLM corruption: shattered JSX fragments as JSON arrays like
   * [{"react'...":"..."},{},"type=\"number"].
   * Exception: config files like tailwind.config.js use `export default {...}`
   * which starts with `export`, not `{` — so this check is safe.
   */
  if ((ext === 'jsx' || ext === 'tsx') && (trimmed.startsWith('[') || trimmed.startsWith('{'))) {
    // Check if it's actually valid JSON (double corruption check)
    try {
      JSON.parse(trimmed);
      return (
        `REFUSED — ${path} content is valid JSON but JSX/TSX files must contain React source code, ` +
        `not JSON. JSX starts with "import" or "function" or "const", never "[" or "{". ` +
        `Re-write ${path} with actual JSX source as a raw string.`
      );
    } catch {
      // Not valid JSON but starts with [ or { — still suspicious for JSX
      if (trimmed.startsWith('[')) {
        return (
          `REFUSED — ${path} content starts with '[' — JSX/TSX files must not start with '['. ` +
          `Re-write ${path} with actual JSX source as a raw string.`
        );
      }
    }
  }

  /*
   * JS/TS source files (not config files) should not start with raw JSON.
   * Config files (tailwind.config.js, postcss.config.js, vite.config.js)
   * use `export default` or `module.exports` — they don't start with { or [.
   * If a .js file starts with { or [, it's likely corruption.
   * Exception: .json files ARE expected to start with { or [.
   */
  if ((ext === 'js' || ext === 'ts' || ext === 'mjs' || ext === 'cjs') && !baseName.includes('.config.')) {
    if (trimmed.startsWith('[')) {
      return (
        `REFUSED — ${path} content starts with '[' — JS/TS source files must not start with '['. ` +
        `Re-write ${path} with actual JavaScript/TypeScript source as a raw string.`
      );
    }
  }

  /*
   * JSON files must be valid JSON. If they're not, the build will fail later.
   */
  if (ext === 'json') {
    try {
      JSON.parse(content);
    } catch (e: any) {
      return (
        `REFUSED — ${path} is a .json file but content is not valid JSON: ${e?.message ?? 'parse error'}. ` +
        `Re-write ${path} with valid JSON.`
      );
    }
  }

  return null; // content is valid
}
