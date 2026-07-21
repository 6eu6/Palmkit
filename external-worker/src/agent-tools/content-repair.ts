/**
 * Content repair utility — extracts usable source code from malformed file
 * content produced by the LLM.
 *
 * Extracted from agent-tools.ts during P4 decomposition.
 */

/**
 * AUTO-REPAIR: extract usable source code from malformed file content.
 *
 * GLM-4.x sometimes wraps file content in JSON even after being told not to.
 * This function tries to salvage usable source code from whatever the model
 * sent, so the build can proceed instead of looping forever.
 *
 * Strategies (in order):
 *  1. If it's a JSON object with a "content"/"text"/"code"/"source" string key, extract it.
 *  2. If it's a JSON array of strings, join them with newlines.
 *  3. If it's a JSON array of objects, look for a "content"/"text" field in each.
 *  4. If it's a stringified code block (```js\n...```), extract the inner code.
 *  5. If nothing works, return null (caller will reject).
 */
export function attemptContentRepair(raw: string, path: string): string | null {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const isCodeFile = ['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'html', 'css', 'scss', 'py', 'rb', 'go', 'rs', 'java'].includes(ext);

  // Strategy 4: code block fences (```js\n...```)
  if (isCodeFile) {
    const fenceMatch = raw.match(/```(?:[a-z]*)\n?([\s\S]*?)```/);
    if (fenceMatch && fenceMatch[1] && fenceMatch[1].trim().length > 10) {
      return fenceMatch[1].trim();
    }
  }

  const trimmed = raw.trimStart();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return null; // not JSON, can't repair
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  // Strategy 1: object with content/text/code/source key
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    for (const key of ['content', 'text', 'code', 'source', 'file_content', 'body']) {
      const val = obj[key];
      if (typeof val === 'string' && val.length > 0) {
        // Recursively repair in case the inner value is also JSON-wrapped
        const inner = attemptContentRepair(val, path);
        return inner ?? val;
      }
    }
    // If the object has no recognizable key, try to stringify it as a module
    if (isCodeFile && (ext === 'js' || ext === 'mjs' || ext === 'jsx' || ext === 'ts' || ext === 'tsx')) {
      return `export default ${JSON.stringify(obj, null, 2)};\n`;
    }
  }

  // Strategy 2: array of strings
  if (Array.isArray(parsed)) {
    if (parsed.every((item) => typeof item === 'string') && parsed.length > 0) {
      return parsed.join('\n');
    }
    // Strategy 3: array of objects with content/text fields
    const extracted = parsed
      .map((item) => {
        if (item && typeof item === 'object') {
          const obj = item as Record<string, unknown>;
          for (const key of ['content', 'text', 'code', 'line', 'source']) {
            if (typeof obj[key] === 'string') return obj[key] as string;
          }
        }
        return null;
      })
      .filter((s): s is string => s !== null);

    if (extracted.length > 0) {
      return extracted.join('\n');
    }
  }

  return null;
}
