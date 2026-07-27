/**
 * Global tool-call argument repairer.
 *
 * Extracted from orchestrator.ts during P4 decomposition.
 *
 * The root fix for GLM's string-serialization habit. GLM-4.x/5.x models
 * frequently pass structured arguments as JSON STRINGS ('[{...}]' for arrays,
 * '{"width":390}' for objects). A strict schema then fails validation at the
 * SDK layer and the error aborts the whole stream — this killed live builds
 * three separate ways (done(), write_files(), analyze_screenshot()) before
 * per-tool guards were added.
 *
 * Instead of patching every tool schema forever, this repairer runs ONLY when
 * the SDK reports InvalidToolArgumentsError, deep-walks the args, and parses
 * any string value that is itself valid JSON of an object/array.
 * Deterministic (no extra LLM call); returns null when it cannot help so the
 * original error surfaces unchanged.
 */

/**
 * Deep-walks a parsed args object/array, parsing any string value that is
 * itself valid JSON of an object/array. Returns the repaired args (re-stringified)
 * or null when no change was made.
 */
export function repairStringifiedArgs(argsJson: string): string | null {
  const looksJson = (s: string) => {
    const t = s.trimStart();
    return t.startsWith('{') || t.startsWith('[');
  };

  const deepRepair = (v: unknown): { value: unknown; changed: boolean } => {
    if (typeof v === 'string' && looksJson(v)) {
      try {
        const parsed = JSON.parse(v);

        if (parsed && typeof parsed === 'object') {
          return { value: deepRepair(parsed).value, changed: true };
        }
      } catch {
        /* not JSON — keep the string */
      }

      return { value: v, changed: false };
    }

    if (Array.isArray(v)) {
      let changed = false;
      const out = v.map((item) => {
        const r = deepRepair(item);
        changed = changed || r.changed;

        return r.value;
      });

      return { value: out, changed };
    }

    if (v && typeof v === 'object') {
      let changed = false;
      const out: Record<string, unknown> = {};

      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        const r = deepRepair(val);
        changed = changed || r.changed;
        out[k] = r.value;
      }

      return { value: out, changed };
    }

    return { value: v, changed: false };
  };

  try {
    const parsed = JSON.parse(argsJson);
    const { value, changed } = deepRepair(parsed);

    return changed ? JSON.stringify(value) : null;
  } catch {
    return null;
  }
}
