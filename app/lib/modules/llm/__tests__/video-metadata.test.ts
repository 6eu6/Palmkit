import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchOpenRouterVideoMetadata } from '~/lib/modules/llm/sources/provider-metadata';
import { mergeFragments } from '~/lib/modules/llm/model-descriptor';

/**
 * Video models describe themselves in a different vocabulary.
 *
 * The fixture is the real response for `google/veo-3.1-lite`, trimmed. It has
 * no `architecture`, no `pricing`, no `context_length` — the three fields the
 * text-model parser reads. Handed to that parser it produces a model that
 * appears to do nothing at all, which is why the catalog reported zero video
 * models while twenty were available.
 */
const VEO_LITE = {
  id: 'google/veo-3.1-lite',
  name: 'Google: Veo 3.1 Lite',
  supported_resolutions: ['720p', '1080p'],
  supported_aspect_ratios: ['16:9', '9:16'],
  supported_sizes: ['1280x720', '720x1280', '1920x1080', '1080x1920'],
  supported_durations: [8, 4, 6],
  supported_frame_images: ['first_frame', 'last_frame'],
  generate_audio: true,
  pricing_skus: {
    duration_seconds_with_audio: '0.08',
    duration_seconds_without_audio: '0.05',
    duration_seconds_without_audio_720p: '0.03',
  },
};

/** A model that takes a prompt only — no frame images, no soundtrack. */
const TEXT_ONLY_VIDEO = {
  id: 'someone/prompt-only-video',
  name: 'Prompt Only',
  supported_durations: [5],
  generate_audio: false,
  pricing_skus: {},
};

function mockModels(models: unknown[], status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ data: models }), { status })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchOpenRouterVideoMetadata', () => {
  it('reads what a video model states about itself', async () => {
    mockModels([VEO_LITE]);

    const f = (await fetchOpenRouterVideoMetadata()).get('google/veo-3.1-lite');

    expect(f).toBeDefined();
    expect(f!.source).toBe('provider-api');
    expect(f!.output).toMatchObject({ video: true, text: false, audio: true });
    expect(f!.media).toMatchObject({
      durations: [8, 4, 6],
      aspectRatios: ['16:9', '9:16'],
      frameImages: ['first_frame', 'last_frame'],
      generatesAudio: true,
    });
  });

  /*
   * `supported_frame_images` is the machine-readable form of "you can hand
   * this a picture and it will animate it". Nothing else in the response says
   * so, so image input has to be derived from it.
   */
  it('derives image input from the frames it accepts', async () => {
    mockModels([VEO_LITE, TEXT_ONLY_VIDEO]);

    const all = await fetchOpenRouterVideoMetadata();

    expect(all.get('google/veo-3.1-lite')!.input).toMatchObject({ image: true });
    expect(all.get('someone/prompt-only-video')!.input).toMatchObject({ image: false });
  });

  it('keeps per-second pricing as its own thing, not a per-token price', async () => {
    mockModels([VEO_LITE]);

    const f = (await fetchOpenRouterVideoMetadata()).get('google/veo-3.1-lite')!;

    expect(f.cost?.perSecond).toEqual({
      duration_seconds_with_audio: 0.08,
      duration_seconds_without_audio: 0.05,
      duration_seconds_without_audio_720p: 0.03,
    });

    // A per-token price would make it comparable to text models. It is not.
    expect(f.cost?.completionPerM).toBeUndefined();
    expect(f.cost?.promptPerM).toBeUndefined();
  });

  it('omits pricing entirely when the provider states none', async () => {
    mockModels([TEXT_ONLY_VIDEO]);

    const f = (await fetchOpenRouterVideoMetadata()).get('someone/prompt-only-video')!;

    expect(f.cost?.perSecond).toBeUndefined();
  });

  it('reports nothing rather than throwing when the endpoint is unavailable', async () => {
    mockModels([], 500);

    expect((await fetchOpenRouterVideoMetadata()).size).toBe(0);
  });

  /*
   * The heuristic guesses from the name. `veo-3.1-lite` contains no word it
   * recognises as video, so it would call this a text model — and the merge
   * has to let the provider's statement win.
   */
  it('overrides a name-based guess when merged', async () => {
    mockModels([VEO_LITE]);

    const fromProvider = (await fetchOpenRouterVideoMetadata()).get('google/veo-3.1-lite')!;

    const merged = mergeFragments('OpenRouter', 'google/veo-3.1-lite', [
      { output: { text: true, video: false }, source: 'heuristic' },
      fromProvider,
    ]);

    expect(merged.output.video).toBe(true);
    expect(merged.output.text).toBe(false);
    expect(merged.source).toBe('provider-api');
    expect(merged.media?.frameImages).toContain('first_frame');
  });
});
