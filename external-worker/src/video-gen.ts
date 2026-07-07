/**
 * Video generation — let the agent create looping video assets.
 *
 * RADICAL REBUILD: there was NO video generation capability in Palmkit.
 * The user asked for "a video of a person coding as a hero background,
 * looped, proper dimensions" and the model couldn't even attempt it.
 *
 * This module wraps video generation APIs. Currently supports:
 *   1. Z.ai video models (house SDK, recommended)
 *   2. OpenRouter video-capable models (fallback)
 *
 * Returns an OSS-hosted MP4 URL that the Builder writes as a <video>
 * element with autoplay muted loop playsinline.
 */
import { logger } from './logger';

export interface VideoGenOptions {
  apiKey: string;
  model?: string;
  prompt: string;
  duration?: number; // seconds, 2-10
  aspectRatio?: '16:9' | '9:16' | '1:1';
  provider?: 'zai' | 'openrouter' | 'google';
}

export interface GeneratedVideo {
  url: string; // direct MP4 URL
  bytes: number;
  duration: number;
  aspectRatio: string;
}

const DEFAULT_VIDEO_MODEL = 'cogvideox-2b';

/**
 * Generate a short looping video.
 *
 * Tries Z.ai first (house SDK, fastest), falls back to OpenRouter.
 * Returns a direct MP4 URL the builder can fetch + embed.
 */
export async function generateVideo(opts: VideoGenOptions): Promise<GeneratedVideo> {
  const {
    apiKey,
    model = DEFAULT_VIDEO_MODEL,
    prompt,
    duration = 5,
    aspectRatio = '16:9',
    provider = 'zai',
  } = opts;

  logger.info(`[video-gen] Generating video: model=${model}, duration=${duration}s, ratio=${aspectRatio}`);

  if (provider === 'openrouter') {
    return generateViaOpenRouter(apiKey, model, prompt, duration, aspectRatio);
  }

  return generateViaZai(apiKey, model, prompt, duration, aspectRatio);
}

/**
 * Z.ai video generation endpoint.
 *
 * Z.ai exposes video generation through the same API family as GLM.
 * We POST to the videos/generate endpoint and poll for completion.
 */
async function generateViaZai(
  apiKey: string,
  model: string,
  prompt: string,
  duration: number,
  aspectRatio: string,
): Promise<GeneratedVideo> {
  const sizeMap: Record<string, string> = {
    '16:9': '1280x720',
    '9:16': '720x1280',
    '1:1': '720x720',
  };

  const size = sizeMap[aspectRatio] ?? '1280x720';

  // Submit the generation request
  const submitResp = await fetch('https://api.z.ai/api/paas/v4/videos/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      prompt,
      duration,
      size,
    }),
  });

  if (!submitResp.ok) {
    const errText = await submitResp.text();
    throw new Error(`Z.ai video submit failed (${submitResp.status}): ${errText.slice(0, 500)}`);
  }

  const submitData: any = await submitResp.json();
  const taskId = submitData?.id ?? submitData?.task_id ?? submitData?.data?.id;

  if (!taskId) {
    throw new Error(`Z.ai video: no task id in response: ${JSON.stringify(submitData).slice(0, 500)}`);
  }

  // Poll for completion (up to 5 minutes)
  const maxAttempts = 60;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 5000));

    const pollResp = await fetch(`https://api.z.ai/api/paas/v4/videos/generations/${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!pollResp.ok) {
      logger.warn(`[video-gen] poll ${i + 1} failed: ${pollResp.status}`);
      continue;
    }

    const pollData: any = await pollResp.json();
    const status = pollData?.status ?? pollData?.task_status;

    if (status === 'SUCCEEDED' || status === 'succeeded' || status === 'completed') {
      const videoUrl =
        pollData?.video_result?.[0]?.url ??
        pollData?.videos?.[0]?.url ??
        pollData?.data?.video_url ??
        pollData?.url;

      if (!videoUrl) {
        throw new Error(`Z.ai video: succeeded but no URL: ${JSON.stringify(pollData).slice(0, 500)}`);
      }

      // Get the file size
      let bytes = 0;
      try {
        const head = await fetch(videoUrl, { method: 'HEAD' });
        bytes = Number(head.headers.get('content-length') ?? 0);
      } catch {
        /* best-effort */
      }

      logger.info(`[video-gen] Video ready: ${videoUrl} (${bytes} bytes)`);

      return {
        url: videoUrl,
        bytes,
        duration,
        aspectRatio,
      };
    }

    if (status === 'FAILED' || status === 'failed' || status === 'error') {
      throw new Error(`Z.ai video generation failed: ${JSON.stringify(pollData).slice(0, 500)}`);
    }

    // Still processing (PENDING / PROCESSING / RUNNING)
    logger.debug(`[video-gen] poll ${i + 1}/${maxAttempts}: status=${status}`);
  }

  throw new Error('Z.ai video generation timed out after 5 minutes');
}

/**
 * OpenRouter video generation fallback.
 *
 * OpenRouter doesn't have a dedicated video endpoint, but some models
 * (e.g. Google Veo via OpenRouter) support video output through the
 * chat completions API with modalities: ['video', 'text'].
 */
async function generateViaOpenRouter(
  apiKey: string,
  model: string,
  prompt: string,
  duration: number,
  aspectRatio: string,
): Promise<GeneratedVideo> {
  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      modalities: ['video', 'text'],
      messages: [
        {
          role: 'user',
          content: `${prompt}\n\nDuration: ${duration}s. Aspect ratio: ${aspectRatio}.`,
        },
      ],
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`OpenRouter video failed (${resp.status}): ${errText.slice(0, 500)}`);
  }

  const data: any = await resp.json();
  const videoUrl = data?.choices?.[0]?.message?.videos?.[0]?.url;

  if (!videoUrl) {
    throw new Error(`OpenRouter video: no URL in response: ${JSON.stringify(data).slice(0, 500)}`);
  }

  return {
    url: videoUrl,
    bytes: 0,
    duration,
    aspectRatio,
  };
}
