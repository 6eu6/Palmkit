import { generateVideoSchema, type GenerateVideoInput } from '~/lib/.server/tools/schemas/generate-video';
import { fetchWithTimeout } from '~/lib/.server/tools/schemas/_network';
import type { ToolDefinition, ToolResult } from '~/lib/.server/tools/types';
import type { ModelDescriptor } from '~/lib/modules/llm/model-descriptor';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('generate_video');

/**
 * generate_video — a moving picture, from a description or from a still.
 *
 * Video does not work like anything else here. The request returns a job, not
 * a result; the job takes between forty seconds and two minutes; and it is
 * billed by the second of output, so the difference between two models doing
 * the same job was $0.20 and $3.20 in testing. All three facts shape this
 * file: it polls, it bounds the wait, and it never starts a job without first
 * working out what that job will cost.
 *
 * Nothing here names a model. Which one runs comes from the catalog, and what
 * it accepts — durations, aspect ratios, whether it can start from an image —
 * comes from that model's own declaration, so a request is shaped to the
 * model rather than to an enum written down once and left to rot.
 */

const OPENROUTER = 'https://openrouter.ai/api/v1';

/**
 * How long to wait before handing the job back unfinished.
 *
 * Observed: 40s for veo-3.1-lite, 80s for veo-3.1. The ceiling is a
 * compromise with the request lifetime — past it the job id is returned so
 * the work already paid for is not lost.
 */
const MAX_WAIT_MS = 150_000;
const POLL_EVERY_MS = 5_000;

interface VideoJob {
  id: string;
  status?: string;
  unsigned_urls?: string[];
  usage?: { cost?: number };
  error?: unknown;
}

/** The nearest duration the model actually offers. */
function closestDuration(requested: number | undefined, supported: number[] | undefined): number | undefined {
  if (!supported?.length) {
    return requested;
  }

  if (requested === undefined) {
    // Shortest available: the cheapest thing that still answers the request.
    return Math.min(...supported);
  }

  return supported.reduce((best, d) => (Math.abs(d - requested) < Math.abs(best - requested) ? d : best));
}

/**
 * What this will cost, from the model's own rate card.
 *
 * The SKU names encode resolution and audio (`duration_seconds_with_audio`,
 * `..._without_audio_720p`), so the right one is picked by matching both
 * rather than by taking the first entry.
 */
function estimateCost(d: ModelDescriptor, seconds: number): { usd?: number; sku?: string } {
  const skus = d.cost.perSecond;

  if (!skus) {
    return {};
  }

  const entries = Object.entries(skus);

  /*
   * Audio is not optional on these models and is not free.
   *
   * veo-3.1-lite declares `generate_audio: true` and lists no passthrough
   * parameter to turn it off, so every clip comes with a soundtrack and is
   * billed at the with-audio rate. This used to estimate the without-audio
   * rate whenever the caller had not asked for audio, which is the caller
   * describing a request the provider does not accept.
   */
  const audio = d.media?.generatesAudio === true;
  const matching = entries.filter(([name]) =>
    audio ? name.includes('with_audio') || !name.includes('audio') : name.includes('without_audio'),
  );

  const pool = matching.length ? matching : entries;

  /*
   * The tier that applies, not the cheapest that exists.
   *
   * No resolution is requested, so the provider uses its default and bills
   * the SKU with no resolution suffix. Taking the minimum instead picked the
   * 720p rate and under-quoted a real job by two and a half times: $0.12
   * promised against $0.32 charged.
   */
  const base = pool.filter(([name]) => !/_\d+p$|_4k$/.test(name));
  const [sku, rate] = (base.length ? base : pool).reduce((best, cur) => (cur[1] > best[1] ? cur : best));

  return { usd: Number((rate * seconds).toFixed(4)), sku };
}

export const generateVideoTool: ToolDefinition<typeof generateVideoSchema> = {
  name: 'generate_video',
  description:
    'Generate a short video from a description, optionally starting from an image. ' +
    'Use this when the user asks for a video, a clip, an animation, or asks to "make this image move". ' +
    'To animate an existing picture, pass the `url` that generate_image returned as imageUrl — ' +
    'that is how "turn this into a video" works. ' +
    'Describe MOTION, not just the scene: what moves, how the camera moves, what the light does. ' +
    'Returns a video URL plus the model used and what it cost. ' +
    'This is slow (roughly 40-90 seconds) and costs real money, typically $0.10-$0.50 — ' +
    'do not call it speculatively or more than once for the same request. ' +
    'Do NOT use this for still images (use generate_image).',

  inputSchema: generateVideoSchema,
  availableIn: ['chat', 'work', 'code'],

  execute: async (input: GenerateVideoInput, ctx): Promise<ToolResult> => {
    const { prompt, imageUrl, durationSeconds, aspectRatio } = input;

    const apiKey = ctx.apiKeys?.OpenRouter;

    if (!apiKey) {
      return {
        ok: false,
        error: 'No OpenRouter key is connected, so there is no model available to generate video.',
        hint: 'Add one in Settings → Model providers.',
      };
    }

    const route = await ctx.routeModel?.('video');

    if (!route) {
      return {
        ok: false,
        error: 'No video-generating model was found in your connected provider.',
        hint: 'Open Settings → Model providers → Refresh capabilities, then try again.',
      };
    }

    const media = route.descriptor.media;
    const seconds = closestDuration(durationSeconds, media?.durations) ?? 4;

    /*
     * A starting frame is only possible on models that declare it. Sending one
     * to a model that does not is a request the provider rejects, so it is
     * dropped with a note rather than failing the whole call.
     */
    const canStartFromImage = media?.frameImages?.includes('first_frame') ?? false;

    /*
     * The model holds a link, never the pixels. The bytes are fetched here so
     * they go from storage straight to the provider without passing through
     * the conversation — which is the whole reason the link exists.
     */
    const frame = imageUrl && canStartFromImage ? await ctx.readOwnMedia?.(imageUrl) : undefined;
    const useImage = Boolean(frame);

    /*
     * Whether there is a soundtrack is the model's business, not the
     * caller's: these models list no parameter to turn it off.
     */
    const withAudio = media?.generatesAudio ?? false;

    const cost = estimateCost(route.descriptor, seconds);

    const body: Record<string, unknown> = { model: route.model, prompt, duration: seconds };

    if (aspectRatio && media?.aspectRatios?.includes(aspectRatio)) {
      body.aspect_ratio = aspectRatio;
    }

    if (useImage) {
      body.input_images = [{ type: 'first_frame', image_url: { url: frame } }];
    }

    try {
      const start = await fetchWithTimeout(`${OPENROUTER}/videos`, {
        method: 'POST',
        timeoutMs: 60_000,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://palmkit.app',
          'X-Title': 'Palmkit',
        },
        body: JSON.stringify(body),
      });

      const startText = await start.text();

      if (start.status !== 202 && !start.ok) {
        return {
          ok: false,
          error: `Video generation was refused (HTTP ${start.status}) by ${route.model}: ${startText.slice(0, 200)}`,
          hint:
            start.status === 402
              ? 'Your provider account is out of credit.'
              : start.status === 401
                ? 'The stored key was rejected. Replace it in Settings → Model providers.'
                : 'Try a shorter duration or a different aspect ratio.',
        };
      }

      const job = JSON.parse(startText) as VideoJob;

      if (!job.id) {
        return { ok: false, error: `${route.model} accepted the request but returned no job id.` };
      }

      logger.info(`video job ${job.id} started on ${route.model} (${seconds}s, ~$${cost.usd ?? '?'})`);

      const finished = await pollUntilDone(apiKey, job.id);

      if (finished.status !== 'completed') {
        return {
          ok: false,

          /*
           * The job id goes back in the message on purpose. The generation is
           * still running and already billed; without the id there is no way
           * to collect what was paid for.
           */
          error:
            finished.status === 'failed'
              ? `${route.model} failed to generate the video.`
              : `Still rendering after ${MAX_WAIT_MS / 1000}s. Job ${job.id} is still running.`,
          jobId: job.id,
          model: route.model,
        } as ToolResult;
      }

      const providerUrl = finished.unsigned_urls?.[0];

      if (!providerUrl) {
        return { ok: false, error: `${route.model} reported success but returned no video.` };
      }

      /*
       * The provider's URL needs the API key as a bearer token, so a browser
       * cannot play it and it must never be handed to one — that link plus a
       * key is the key. A copy is stored and the playable link points there.
       */
      const url = (await storeCopy(apiKey, providerUrl, ctx)) ?? providerUrl;
      const playable = url !== providerUrl;

      return {
        ok: true,
        model: route.model,
        whyThisModel: route.reason,
        url,
        playable,
        prompt,
        durationSeconds: seconds,
        aspectRatio: (body.aspect_ratio as string) ?? null,
        startedFromImage: useImage,
        withAudio,

        /* What was actually charged, when the provider reports it. */
        costUsd: finished.usage?.cost ?? cost.usd ?? null,
        estimatedCostUsd: cost.usd ?? null,

        note: !imageUrl
          ? undefined
          : !canStartFromImage
            ? `${route.model} cannot start from an image, so the video was generated from the description alone.`
            : !frame
              ? 'The starting image could not be read, so the video was generated from the description alone.'
              : undefined,
      };
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortTimeoutError') {
        return { ok: false, error: 'The provider did not respond when starting the video job.' };
      }

      return { ok: false, error: `Video generation failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};

/**
 * Fetch the finished video and keep a copy.
 *
 * Returns undefined if it cannot, in which case the caller falls back to the
 * provider's own URL and marks the result unplayable rather than pretending
 * a link that needs a secret is one a browser can follow.
 */
async function storeCopy(
  apiKey: string,
  providerUrl: string,
  ctx: { storeMedia?: (bytes: Uint8Array, mime: string) => Promise<{ url: string } | undefined> },
): Promise<string | undefined> {
  if (!ctx.storeMedia) {
    return undefined;
  }

  try {
    const res = await fetchWithTimeout(providerUrl, {
      timeoutMs: 120_000,
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!res.ok) {
      return undefined;
    }

    const bytes = new Uint8Array(await res.arrayBuffer());
    const stored = await ctx.storeMedia(bytes, res.headers.get('content-type') ?? 'video/mp4');

    return stored?.url;
  } catch (err) {
    logger.warn(`Could not store the finished video: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

async function pollUntilDone(apiKey: string, id: string): Promise<VideoJob> {
  const deadline = Date.now() + MAX_WAIT_MS;
  let last: VideoJob = { id, status: 'pending' };
  let first = true;

  while (Date.now() < deadline) {
    /*
     * Ask before waiting. Sleeping first adds a fixed delay to every job even
     * when it is already done, and makes the loop impossible to test without
     * burning the interval on each case.
     */
    if (!first) {
      await new Promise((r) => setTimeout(r, POLL_EVERY_MS));
    }

    first = false;

    try {
      const res = await fetchWithTimeout(`${OPENROUTER}/videos/${id}`, {
        timeoutMs: 20_000,
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      if (!res.ok) {
        continue;
      }

      last = (await res.json()) as VideoJob;

      if (last.status === 'completed' || last.status === 'failed') {
        return last;
      }
    } catch {
      /*
       * A dropped poll is not a failed job. The generation continues on the
       * provider's side, so keep asking until the deadline.
       */
    }
  }

  return last;
}
