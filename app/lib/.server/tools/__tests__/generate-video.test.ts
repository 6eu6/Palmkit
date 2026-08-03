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
  };

  return ctx;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const IMAGE = 'data:image/png;base64,aGk=';

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
    const result = await generateVideoTool.execute({ prompt: 'x', imageDataUrl: IMAGE }, ctx);

    expect(requests[0].body.input_images).toEqual([{ type: 'first_frame', image_url: { url: IMAGE } }]);
    expect(result.ok && result.startedFromImage).toBe(true);
  });

  /*
   * Sending a frame to a model that does not declare one is a request the
   * provider rejects outright. Better to generate from the description and
   * say so than to fail the whole call.
   */
  it('drops the starting frame on a model that cannot use it, and says so', async () => {
    const ctx = mockProvider(promptOnly());
    const result = await generateVideoTool.execute({ prompt: 'x', imageDataUrl: IMAGE }, ctx);

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
   * Audio is the difference between $0.03 and $0.05 a second on this model,
   * so it is opt-in and the estimate has to reflect which rate applies.
   */
  it('estimates from the rate that matches the request', async () => {
    const ctx = mockProvider(veoLite());
    const silent = await generateVideoTool.execute({ prompt: 'x', durationSeconds: 4 }, ctx);

    // 4s x $0.03 (cheapest without-audio tier)
    expect(silent.ok && silent.estimatedCostUsd).toBeCloseTo(0.12, 4);

    const ctx2 = mockProvider(veoLite());
    const loud = await generateVideoTool.execute({ prompt: 'x', durationSeconds: 4, withAudio: true }, ctx2);

    // 4s x $0.05 (cheapest with-audio tier)
    expect(loud.ok && loud.estimatedCostUsd).toBeCloseTo(0.2, 4);
    expect(loud.ok && loud.withAudio).toBe(true);
  });

  it('does not ask for audio from a model that makes none', async () => {
    const ctx = mockProvider(promptOnly());
    const result = await generateVideoTool.execute({ prompt: 'x', withAudio: true }, ctx);

    expect(result.ok && result.withAudio).toBe(false);
  });

  it('reports what the provider actually charged, not the estimate', async () => {
    const ctx = mockProvider(veoLite(), { cost: 0.47 });
    const result = await generateVideoTool.execute({ prompt: 'x', durationSeconds: 4 }, ctx);

    expect(result.ok && result.costUsd).toBe(0.47);
    expect(result.ok && result.estimatedCostUsd).toBeCloseTo(0.12, 4);
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
