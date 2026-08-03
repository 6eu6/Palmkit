import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchOpenRouterVideoMetadata, perSecondRates } from '~/lib/modules/llm/sources/provider-metadata';
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

/**
 * The rate card is not in one unit.
 *
 * Every case below is a real `pricing_skus` object from the live catalogue.
 * Read naively — minimum of the values, called dollars per second — they
 * disagree with reality by up to five orders of magnitude, and the router
 * picks whichever model is most wrong.
 */
describe('perSecondRates', () => {
  it('takes dollars per second as they are', () => {
    expect(perSecondRates({ duration_seconds_720p: '0.0988', duration_seconds_1080p: '0.1278' })).toEqual({
      duration_seconds_720p: 0.0988,
      duration_seconds_1080p: 0.1278,
    });
  });

  it('converts cents per second to dollars', () => {
    // runway/gen-4.5: 12 cents a second is $0.12, not $12.
    expect(perSecondRates({ cents_per_second_output: '12' })).toEqual({ cents_per_second_output: 0.12 });
  });

  /*
   * bytedance/seedance-1-5-pro prices by video token. Read as a per-second
   * rate it is $0.0000012 — cheapest video model in the catalog by five
   * orders of magnitude, and the one routing actually chose. The same job
   * cost $0.21 against veo-3.1-lite's $0.12.
   */
  it('refuses to read a per-token price as a per-second price', () => {
    expect(perSecondRates({ video_tokens: '0.0000024', video_tokens_without_audio: '0.0000012' })).toEqual({});
  });

  it('ignores prices that are not per second at all', () => {
    expect(
      perSecondRates({
        reference_images: '0.04',
        cents_per_image_input: '1',
        minimum_cents_per_generation: '56',
        cents_per_video_output_second_720p: '14',
      }),
    ).toEqual({ cents_per_video_output_second_720p: 0.14 });
  });

  it('handles a missing rate card', () => {
    expect(perSecondRates(undefined)).toEqual({});
    expect(perSecondRates({})).toEqual({});
  });

  it('drops values that are not numbers', () => {
    expect(perSecondRates({ duration_seconds: 'n/a', duration_seconds_720p: '-1' })).toEqual({});
  });
});
