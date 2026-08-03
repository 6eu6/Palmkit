import type { DescriptorFragment } from '~/lib/modules/llm/model-descriptor';

/**
 * Layer 1 — what the provider states about its own models.
 *
 * The best source there is, and free, but only some providers offer it.
 * OpenRouter publishes modalities, supported parameters, price and context for
 * every model it proxies; Google publishes generation methods and token
 * limits. OpenAI, Anthropic, Groq, Together and DeepSeek publish model IDs and
 * nothing else — those fall through to the catalog and the probe.
 */

interface OpenRouterModel {
  id: string;
  name?: string;
  context_length?: number;
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
    modality?: string;
  };
  supported_parameters?: string[];
  pricing?: { prompt?: string; completion?: string; input_cache_read?: string };
  top_provider?: { max_completion_tokens?: number };
}

/** Prices arrive as per-token strings; the rest of the app thinks per million. */
function perMillion(value?: string): number | undefined {
  if (!value) {
    return undefined;
  }

  const n = Number.parseFloat(value);

  return Number.isFinite(n) ? n * 1_000_000 : undefined;
}

export async function fetchOpenRouterMetadata(): Promise<Map<string, DescriptorFragment>> {
  const out = new Map<string, DescriptorFragment>();

  const res = await fetch('https://openrouter.ai/api/v1/models');

  if (!res.ok) {
    return out;
  }

  const body = (await res.json()) as { data?: OpenRouterModel[] };

  for (const m of body.data ?? []) {
    const inputs = m.architecture?.input_modalities ?? [];
    const outputs = m.architecture?.output_modalities ?? [];
    const params = m.supported_parameters ?? [];

    out.set(m.id, {
      displayName: m.name,
      input: {
        text: inputs.includes('text'),
        image: inputs.includes('image'),
        audio: inputs.includes('audio'),
        video: inputs.includes('video'),
        pdf: inputs.includes('file'),
      },
      output: {
        text: outputs.includes('text'),
        image: outputs.includes('image'),
        audio: outputs.includes('audio'),
        video: outputs.includes('video'),
        embedding: false,
      },
      reasoning: {
        supported: params.includes('reasoning') || params.includes('include_reasoning'),

        /*
         * `reasoning` as a supported PARAMETER is exactly the distinction that
         * matters for the effort control: the caller can ask for more or less.
         * A model that always reasons but takes no parameter does not appear
         * here, and is caught by the catalog or the probe.
         */
        controllable: params.includes('reasoning'),
      },
      tools: {
        functionCalling: params.includes('tools') || params.includes('tool_choice'),
        structuredOutput: params.includes('structured_outputs') || params.includes('response_format'),
        parallel: params.includes('parallel_tool_calls'),
      },
      limits: {
        contextTokens: m.context_length,
        maxOutputTokens: m.top_provider?.max_completion_tokens,
      },
      cost: {
        promptPerM: perMillion(m.pricing?.prompt),
        completionPerM: perMillion(m.pricing?.completion),
        cachedPromptPerM: perMillion(m.pricing?.input_cache_read),
      },
      source: 'provider-api',
    });
  }

  return out;
}

/**
 * Video models, which `/models` does not list.
 *
 * This is why the capability summary reported "Generate video: 0" while
 * OpenRouter had twenty video models the whole time. They live behind
 * `/videos/models` and describe themselves in a different vocabulary: no
 * `architecture`, no `pricing`, no context length — durations, aspect ratios,
 * which frames you may pin, and a price per second of output.
 *
 * Reading only one endpoint and calling the result a catalog is exactly the
 * kind of confident wrongness the descriptor exists to prevent.
 */
interface OpenRouterVideoModel {
  id: string;
  name?: string;
  supported_durations?: number[];
  supported_aspect_ratios?: string[];
  supported_resolutions?: string[];
  supported_sizes?: string[];
  supported_frame_images?: string[];
  generate_audio?: boolean;
  pricing_skus?: Record<string, string>;
}

export async function fetchOpenRouterVideoMetadata(): Promise<Map<string, DescriptorFragment>> {
  const out = new Map<string, DescriptorFragment>();

  const res = await fetch('https://openrouter.ai/api/v1/videos/models');

  if (!res.ok) {
    return out;
  }

  const body = (await res.json()) as { data?: OpenRouterVideoModel[] };

  for (const m of body.data ?? []) {
    const perSecond: Record<string, number> = {};

    for (const [sku, value] of Object.entries(m.pricing_skus ?? {})) {
      const n = Number.parseFloat(value);

      if (Number.isFinite(n)) {
        perSecond[sku] = n;
      }
    }

    out.set(m.id, {
      displayName: m.name,

      /*
       * A prompt, and optionally a frame to start from. `supported_frame_images`
       * containing `first_frame` is the machine-readable form of "this model
       * can animate a picture you give it".
       */
      input: { text: true, image: (m.supported_frame_images?.length ?? 0) > 0 },
      output: { text: false, video: true, audio: m.generate_audio === true },

      /* Video models do not chat, reason on request, or call tools. */
      reasoning: { supported: false, controllable: false },
      tools: { functionCalling: false, structuredOutput: false, parallel: false },

      cost: Object.keys(perSecond).length > 0 ? { perSecond } : {},
      media: {
        durations: m.supported_durations,
        aspectRatios: m.supported_aspect_ratios,
        resolutions: m.supported_resolutions,
        sizes: m.supported_sizes,
        frameImages: m.supported_frame_images,
        generatesAudio: m.generate_audio,
      },
      source: 'provider-api',
    });
  }

  return out;
}

interface GoogleModel {
  name: string;
  displayName?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  supportedGenerationMethods?: string[];
}

export async function fetchGoogleMetadata(apiKey: string): Promise<Map<string, DescriptorFragment>> {
  const out = new Map<string, DescriptorFragment>();

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);

  if (!res.ok) {
    return out;
  }

  const body = (await res.json()) as { models?: GoogleModel[] };

  for (const m of body.models ?? []) {
    const id = m.name.replace(/^models\//, '');
    const methods = m.supportedGenerationMethods ?? [];

    /*
     * Google states limits and methods but not modalities, so this fragment
     * deliberately leaves input/output alone rather than asserting defaults —
     * an empty field lets a weaker source fill it instead of overwriting a
     * correct answer with a guess.
     */
    out.set(id, {
      displayName: m.displayName,
      output: methods.includes('embedContent') ? { text: false, embedding: true } : undefined,
      limits: { contextTokens: m.inputTokenLimit, maxOutputTokens: m.outputTokenLimit },
      source: 'provider-api',
    });
  }

  return out;
}

/** Which providers can answer for themselves, and whether they need a key. */
export const METADATA_PROVIDERS: Record<string, { needsKey: boolean }> = {
  OpenRouter: { needsKey: false },
  Google: { needsKey: true },
};
