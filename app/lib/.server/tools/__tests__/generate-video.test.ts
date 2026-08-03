import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateVideoTool } from '~/lib/.server/tools/creative/generate-video';
import { emptyDescriptor, type ModelDescriptor } from '~/lib/modules/llm/model-descriptor';
import type { ToolContext } from '~/lib/.server/tools/types';

/**
 * The decisions this tool makes before it spends money.
 *
 * Video is billed by the second and a job cannot be taken back, so the parts
 * worth testing are the ones that run before the request leaves: which
 * duration is asked for, whether a starting frame is sent at all, and what
 * the whole thing is expected to cost.
 */

/** veo-3.1-lite as the provider describes it. */
function veoLite(): ModelDescriptor {
  const d = emptyDescriptor('OpenRouter', 'google/veo-3.1-lite');
  d.output = { text: false, image: false, audio: true, video: true, embedding: false };
  d.input = { text: true, image: true, audio: false, video: false, pdf: false };
  d.media = {
    durations: [8, 4, 6],
    aspectRatios: ['16:9', '9:16'],
    frameImages: ['first_frame', 'last_frame'],
    generatesAudio: true,
  };
  d.cost = {
    perSecond: {
      duration_seconds_with_audio: 0.08,
      duration_seconds_without_audio: 0.05,
      duration_seconds_with_audio_720p: 0.05,
      duration_seconds_without_audio_720p: 0.03,
    },
  };
  d.source = 'provider-api';

  return d;
}

/** A model that cannot animate a still and has no soundtrack. */
function promptOnly(): ModelDescriptor {
  const d = emptyDescriptor('OpenRouter', 'someone/prompt-only');
  d.output = { text: false, image: false, audio: false, video: true, embedding: false };
  d.media = { durations: [5] };
  d.cost = { perSecond: { duration_seconds: 0.02 } };
  d.source = 'provider-api';

  return d;
}

let requests: { url: string; body: any }[] = [];

/** Accepts the job, then reports it finished on the first poll. */
function mockProvider(descriptor: ModelDescriptor, opts: { status?: string; cost?: number } = {}) {
  requests = [];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: any, init: any) => {
      const u = String(url);
      requests.push({ url: u, body: init?.body ? JSON.parse(init.body) : undefined });

      if (init?.method === 'POST' && u.endsWith('/videos')) {
        return new Response(JSON.stringify({ id: 'job_1', status: 'pending' }), { status: 202 });
      }

      return new Response(
        JSON.stringify({
          id: 'job_1',
          status: opts.status ?? 'completed',
          unsigned_urls: ['https://openrouter.ai/api/v1/videos/job_1/content?index=0'],
          usage: { cost: opts.cost ?? 0.2 },
        }),
        { status: 200 },
      );
    }),
  );

  const ctx: ToolContext = {
    mode: 'chat',
    apiKeys: { OpenRouter: 'k' },
    routeModel: async () => ({ model: descriptor.model, descriptor, reason: 'test' }),

    /* Only URLs this app issued are read back, and only on the server. */
    readOwnMedia: async (u: string) => (u === IMAGE_URL ? IMAGE_BYTES : undefined),
    storeMedia: async () => ({ url: 'https://project.supabase.co/stored/video.mp4', path: 'p' }),
  };

  return ctx;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const IMAGE_URL = 'https://project.supabase.co/storage/v1/object/sign/generated-media/u/1.jpg?token=x';
const IMAGE_BYTES = 'data:image/jpeg;base64,aGk=';

describe('generate_video', () => {
  it('refuses clearly when no key is connected', async () => {
    const result = await generateVideoTool.execute({ prompt: 'a palm swaying' }, { mode: 'chat' });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error).toMatch(/no openrouter key/i);
    }
  });

  it('refuses when the catalog has no video model', async () => {
    const result = await generateVideoTool.execute(
      { prompt: 'a palm swaying' },
      { mode: 'chat', apiKeys: { OpenRouter: 'k' }, routeModel: async () => undefined },
    );

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error).toMatch(/no video-generating model/i);
    }
  });

  /*
   * The model states [8, 4, 6]. Asking for 5 must land on one of those, not
   * be forwarded verbatim for the provider to reject.
   */
  it('snaps the duration to one the model supports', async () => {
    const ctx = mockProvider(veoLite());
    await generateVideoTool.execute({ prompt: 'x', durationSeconds: 5 }, ctx);

    expect(requests[0].body.duration).toBe(4);
  });

  it('defaults to the shortest supported duration', async () => {
    const ctx = mockProvider(veoLite());
    const result = await generateVideoTool.execute({ prompt: 'x' }, ctx);

    expect(requests[0].body.duration).toBe(4);
    expect(result.ok && result.durationSeconds).toBe(4);
  });

  it('sends a starting frame as first_frame when the model accepts one', async () => {
    const ctx = mockProvider(veoLite());
    const result = await generateVideoTool.execute({ prompt: 'x', imageUrl: IMAGE_URL }, ctx);

    expect(requests[0].body.input_images).toEqual([{ type: 'first_frame', image_url: { url: IMAGE_BYTES } }]);
    expect(result.ok && result.startedFromImage).toBe(true);
  });

  /*
   * Sending a frame to a model that does not declare one is a request the
   * provider rejects outright. Better to generate from the description and
   * say so than to fail the whole call.
   */
  it('drops the starting frame on a model that cannot use it, and says so', async () => {
    const ctx = mockProvider(promptOnly());
    const result = await generateVideoTool.execute({ prompt: 'x', imageUrl: IMAGE_URL }, ctx);

    expect(requests[0].body.input_images).toBeUndefined();
    expect(result.ok && result.startedFromImage).toBe(false);
    expect(result.ok && result.note).toMatch(/cannot start from an image/i);
  });

  it('only sends an aspect ratio the model lists', async () => {
    const ctx = mockProvider(veoLite());

    await generateVideoTool.execute({ prompt: 'x', aspectRatio: '9:16' }, ctx);
    expect(requests[0].body.aspect_ratio).toBe('9:16');

    const ctx2 = mockProvider(veoLite());
    await generateVideoTool.execute({ prompt: 'x', aspectRatio: '1:1' }, ctx2);
    expect(requests[0].body.aspect_ratio).toBeUndefined();
  });

  /*
   * The estimate has to name the price that will actually be charged.
   *
   * A real run promised $0.12 and was billed $0.32. Two mistakes at once:
   * it assumed audio was off, when veo-3.1-lite always produces audio and
   * lists no parameter to disable it; and it took the cheapest tier that
   * exists (720p) when no resolution is requested, so the base tier applies.
   */
  it('estimates the tier that will actually be billed', async () => {
    const ctx = mockProvider(veoLite());
    const result = await generateVideoTool.execute({ prompt: 'x', durationSeconds: 4 }, ctx);

    // 4s x $0.08 — with audio, base resolution. Exactly what was charged.
    expect(result.ok && result.estimatedCostUsd).toBeCloseTo(0.32, 4);
    expect(result.ok && result.withAudio).toBe(true);
  });

  it('uses the without-audio rate on a model that makes no audio', async () => {
    const d = veoLite();
    d.media = { ...d.media, generatesAudio: false };

    const ctx = mockProvider(d);
    const result = await generateVideoTool.execute({ prompt: 'x', durationSeconds: 4 }, ctx);

    // 4s x $0.05 — without audio, base resolution.
    expect(result.ok && result.estimatedCostUsd).toBeCloseTo(0.2, 4);
    expect(result.ok && result.withAudio).toBe(false);
  });

  it('reports audio from what the model does, not from what was asked', async () => {
    const ctx = mockProvider(promptOnly());
    const result = await generateVideoTool.execute({ prompt: 'x' }, ctx);

    expect(result.ok && result.withAudio).toBe(false);
  });

  it('reports what the provider actually charged, not the estimate', async () => {
    const ctx = mockProvider(veoLite(), { cost: 0.47 });
    const result = await generateVideoTool.execute({ prompt: 'x', durationSeconds: 4 }, ctx);

    expect(result.ok && result.costUsd).toBe(0.47);
    expect(result.ok && result.estimatedCostUsd).toBeCloseTo(0.32, 4);
  });

  /*
   * A job that fails is already billed. Returning the id is the only way to
   * collect, or to explain, what was paid for.
   */
  it('returns the job id when the render does not finish', async () => {
    const ctx = mockProvider(veoLite(), { status: 'failed' });
    const result = await generateVideoTool.execute({ prompt: 'x' }, ctx);

    expect(result.ok).toBe(false);
    expect((result as unknown as { jobId: string }).jobId).toBe('job_1');
  });

  it('surfaces a refusal from the provider with its status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('insufficient credits', { status: 402 })),
    );

    const d = veoLite();
    const result = await generateVideoTool.execute(
      { prompt: 'x' },
      {
        mode: 'chat',
        apiKeys: { OpenRouter: 'k' },
        routeModel: async () => ({ model: d.model, descriptor: d, reason: 'test' }),
      },
    );

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error).toMatch(/402/);
      expect(result.hint).toMatch(/out of credit/i);
    }
  });
});

describe('generate_video storage', () => {
  /*
   * The provider's URL needs the API key as a bearer token. Handing it to a
   * browser is handing over a link that is useless without the key — and
   * useful with it. A copy is stored so the result is actually playable.
   */
  it('stores a copy and returns a link a browser can follow', async () => {
    const ctx = mockProvider(veoLite());
    const result = await generateVideoTool.execute({ prompt: 'x' }, ctx);

    expect(result.ok && result.url).toBe('https://project.supabase.co/stored/video.mp4');
    expect(result.ok && result.playable).toBe(true);
  });

  it('falls back to the provider URL and says it is not playable', async () => {
    const ctx = mockProvider(veoLite());
    const result = await generateVideoTool.execute({ prompt: 'x' }, { ...ctx, storeMedia: undefined });

    expect(result.ok && result.url).toContain('openrouter.ai');
    expect(result.ok && result.playable).toBe(false);
  });

  /*
   * A URL in a tool argument arrived through the model. Reading it back is
   * refused unless this app issued it, so a model cannot make the server
   * fetch an internal address on its behalf.
   */
  it('ignores a starting frame it did not issue', async () => {
    const ctx = mockProvider(veoLite());
    const result = await generateVideoTool.execute(
      { prompt: 'x', imageUrl: 'https://169.254.169.254/latest/meta-data/' },
      ctx,
    );

    expect(requests[0].body.input_images).toBeUndefined();
    expect(result.ok && result.startedFromImage).toBe(false);
    expect(result.ok && result.note).toMatch(/could not be read/i);
  });
});
