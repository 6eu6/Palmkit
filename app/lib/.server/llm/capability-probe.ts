import type { DescriptorFragment } from '~/lib/modules/llm/model-descriptor';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('capability-probe');

/**
 * Layer 3 — ask the model instead of guessing about it.
 *
 * This is what makes the registry work for a model nobody has ever catalogued:
 * a handful of one-token requests whose SUCCESS OR FAILURE is the answer. Send
 * a tool definition — accepted or rejected? Send a 1×1 pixel image — accepted
 * or rejected? The provider's own validation tells us what its docs do not.
 *
 * Each probe caps output at one token, so a full sweep of a model costs a
 * fraction of a cent, and the result is written to a catalog shared by every
 * user — so it happens once for the whole install, not once per person.
 *
 * Only OpenAI-compatible endpoints are probed. That is most of them, and the
 * two providers with real metadata APIs never reach this layer anyway.
 */

/** The smallest legal PNG: one transparent pixel. */
const PIXEL_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const PROBE_TIMEOUT_MS = 20_000;

interface ProbeTarget {
  baseUrl: string;
  apiKey: string;
  model: string;
}

interface Attempt {
  ok: boolean;

  /** Distinguishes "the model refused this feature" from "the key is wrong". */
  status: number;
  error?: string;
}

async function attempt(target: ProbeTarget, body: Record<string, unknown>): Promise<Attempt> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    const res = await fetch(`${target.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${target.apiKey}`,
      },
      body: JSON.stringify({ model: target.model, max_tokens: 1, ...body }),
      signal: controller.signal,
    });

    if (res.ok) {
      return { ok: true, status: res.status };
    }

    const text = await res.text().catch(() => '');

    return { ok: false, status: res.status, error: text.slice(0, 300) };
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A 401/403 means the key is bad, not that the feature is missing — treating
 * those as "unsupported" would brand every capability false for a user who
 * simply pasted the wrong key.
 */
function isAuthFailure(a: Attempt): boolean {
  return a.status === 401 || a.status === 403;
}

export interface ProbeResult {
  fragment?: DescriptorFragment;

  /** Set when the probe could not run at all, so nothing is written. */
  unusable?: string;
}

export async function probeModel(target: ProbeTarget): Promise<ProbeResult> {
  const hello = [{ role: 'user', content: 'hi' }];

  // Baseline: does the model answer at all, and is the key good?
  const base = await attempt(target, { messages: hello });

  if (isAuthFailure(base)) {
    return { unusable: 'authentication failed' };
  }

  if (!base.ok && base.status === 0) {
    return { unusable: base.error ?? 'unreachable' };
  }

  /*
   * A model that rejects a plain message is not one we can characterise —
   * writing "supports nothing" for it would poison the shared catalog.
   */
  if (!base.ok && base.status !== 400) {
    return { unusable: `baseline failed (${base.status})` };
  }

  const [tools, vision, reasoning] = await Promise.all([
    attempt(target, {
      messages: hello,
      tools: [
        {
          type: 'function',
          function: {
            name: 'ping',
            description: 'probe',
            parameters: { type: 'object', properties: {}, additionalProperties: false },
          },
        },
      ],
    }),
    attempt(target, {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'hi' },
            { type: 'image_url', image_url: { url: PIXEL_PNG } },
          ],
        },
      ],
    }),
    attempt(target, { messages: hello, reasoning_effort: 'low' }),
  ]);

  for (const a of [tools, vision, reasoning]) {
    if (isAuthFailure(a)) {
      return { unusable: 'authentication failed' };
    }
  }

  logger.debug(
    `Probed ${target.model}: base=${base.status} tools=${tools.status} vision=${vision.status} reasoning=${reasoning.status}`,
  );

  return {
    fragment: {
      input: { text: true, image: vision.ok },
      output: { text: true },
      tools: { functionCalling: tools.ok },

      /*
       * Accepting `reasoning_effort` proves the effort control has something
       * to drive. It does NOT prove the model reasons when left alone — a
       * model that always reasons but ignores the parameter is the catalog's
       * job, which is why `supported` is only asserted alongside it.
       */
      reasoning: reasoning.ok ? { supported: true, controllable: true } : undefined,
      source: 'probe',
    },
  };
}
