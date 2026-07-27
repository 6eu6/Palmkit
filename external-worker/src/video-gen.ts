/**
 * Video generation — uses z-ai-web-dev-sdk (house SDK) for Z.ai video models.
 *
 * The SDK handles authentication internally — no need for a separate Z.ai API key.
 * The user's OpenRouter key is NOT used for video; the SDK has its own credentials.
 *
 * For non-Z.ai video models, we fall back to direct API calls.
 */
import ZAI from 'z-ai-web-dev-sdk';
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

export async function generateVideo(opts: VideoGenOptions): Promise<GeneratedVideo> {
  const {
    apiKey,
    model = DEFAULT_VIDEO_MODEL,
    prompt,
    duration = 5,
    aspectRatio = '16:9',
    provider = 'zai',
  } = opts;

  logger.info(`[video-gen] Generating video: model=${model}, duration=${duration}s, ratio=${aspectRatio}, provider=${provider}`);

  /*
   * Try the Z.ai SDK first — it handles auth internally and works with the
   * user's existing environment. No separate Z.ai API key needed.
   */
  try {
    return await generateViaZaiSDK(model, prompt, duration, aspectRatio);
  } catch (sdkErr: any) {
    logger.warn(`[video-gen] Z.ai SDK failed: ${sdkErr?.message?.slice(0, 200)}`);

    // Fallback to direct Z.ai API (if user has a Z.ai key)
    try {
      return await generateViaZai(apiKey, model, prompt, duration, aspectRatio);
    } catch (directErr: any) {
      logger.warn(`[video-gen] Z.ai direct failed: ${directErr?.message?.slice(0, 200)}`);

      // Last resort: OpenRouter (may not support video output)
      try {
        return await generateViaOpenRouter(apiKey, model, prompt, duration, aspectRatio);
      } catch (orErr: any) {
        throw new Error(`Video generation failed on all providers. SDK: ${sdkErr?.message?.slice(0, 150)}. Z.ai: ${directErr?.message?.slice(0, 150)}. OpenRouter: ${orErr?.message?.slice(0, 150)}`);
      }
    }
  }
}

/**
 * Generate video via z-ai-web-dev-sdk.
 * The SDK handles auth internally — no API key needed from the user.
 */
async function generateViaZaiSDK(
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

  const zai = await ZAI.create();
  const result: any = await zai.video.generations.create({
    model,
    prompt,
    duration,
    size,
  });

  const taskId = result?.id ?? result?.task_id;

  if (!taskId) {
    throw new Error(`Z.ai SDK: no task id in response: ${JSON.stringify(result).slice(0, 300)}`);
  }

  // Get the auth token from the SDK config for polling
  const authToken = (zai as any)?.config?.token;
  const apiKey = (zai as any)?.config?.apiKey;

  // Poll for completion (up to 5 minutes)
  const maxAttempts = 60;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 5000));

    let pollData: any;
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
      if (apiKey) headers['X-API-Key'] = apiKey;

      const pollResp = await fetch(`https://api.z.ai/api/paas/v4/videos/generations/${taskId}`, { headers });
      if (!pollResp.ok) {
        logger.warn(`[video-gen] SDK poll ${i + 1} HTTP ${pollResp.status}`);
        continue;
      }
      pollData = await pollResp.json();
    } catch (e: any) {
      logger.warn(`[video-gen] SDK poll ${i + 1} failed: ${e?.message?.slice(0, 100)}`);
      continue;
    }

    const status = pollData?.task_status ?? pollData?.status;

    if (status === 'SUCCEEDED' || status === 'succeeded' || status === 'completed') {
      const videoUrl =
        pollData?.video_result?.[0]?.url ??
        pollData?.videos?.[0]?.url ??
        pollData?.data?.video_url ??
        pollData?.url;

      if (!videoUrl) {
        throw new Error(`Z.ai SDK: succeeded but no URL: ${JSON.stringify(pollData).slice(0, 300)}`);
      }

      let bytes = 0;
      try {
        const head = await fetch(videoUrl, { method: 'HEAD' });
        bytes = Number(head.headers.get('content-length') ?? 0);
      } catch { /* best-effort */ }

      logger.info(`[video-gen] SDK video ready: ${videoUrl} (${bytes} bytes)`);
      return { url: videoUrl, bytes, duration, aspectRatio };
    }

    if (status === 'FAILED' || status === 'failed' || status === 'error') {
      throw new Error(`Z.ai SDK: generation failed: ${JSON.stringify(pollData).slice(0, 300)}`);
    }

    logger.debug(`[video-gen] SDK poll ${i + 1}/${maxAttempts}: status=${status}`);
  }

  throw new Error('Z.ai SDK: video generation timed out after 5 minutes');
}

/**
 * Z.ai direct API fallback (if user has a Z.ai API key).
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

  const submitResp = await fetch('https://api.z.ai/api/paas/v4/videos/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, prompt, duration, size }),
  });

  if (!submitResp.ok) {
    const errText = await submitResp.text();
    throw new Error(`Z.ai video submit failed (${submitResp.status}): ${errText.slice(0, 300)}`);
  }

  const submitData: any = await submitResp.json();
  const taskId = submitData?.id ?? submitData?.task_id ?? submitData?.data?.id;

  if (!taskId) {
    throw new Error(`Z.ai video: no task id: ${JSON.stringify(submitData).slice(0, 300)}`);
  }

  const maxAttempts = 60;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 5000));

    const pollResp = await fetch(`https://api.z.ai/api/paas/v4/videos/generations/${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!pollResp.ok) continue;

    const pollData: any = await pollResp.json();
    const status = pollData?.status ?? pollData?.task_status;

    if (status === 'SUCCEEDED' || status === 'succeeded' || status === 'completed') {
      const videoUrl =
        pollData?.video_result?.[0]?.url ??
        pollData?.videos?.[0]?.url ??
        pollData?.data?.video_url ??
        pollData?.url;

      if (!videoUrl) throw new Error(`Z.ai: succeeded but no URL`);

      let bytes = 0;
      try {
        const head = await fetch(videoUrl, { method: 'HEAD' });
        bytes = Number(head.headers.get('content-length') ?? 0);
      } catch { /* best-effort */ }

      return { url: videoUrl, bytes, duration, aspectRatio };
    }

    if (status === 'FAILED' || status === 'failed') {
      throw new Error(`Z.ai: generation failed`);
    }
  }

  throw new Error('Z.ai: timed out after 5 minutes');
}

/**
 * OpenRouter video generation fallback.
 */
async function generateViaOpenRouter(
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
          content: `${prompt}\n\nDuration: ${duration}s. Aspect ratio: ${aspectRatio}. Size: ${size}.`,
        },
      ],
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`OpenRouter video failed (${resp.status}): ${errText.slice(0, 300)}`);
  }

  const data: any = await resp.json();
  const msg = data?.choices?.[0]?.message;

  const videoUrl =
    msg?.videos?.[0]?.url ??
    msg?.video_url ??
    msg?.content?.find?.((c: any) => c?.type === 'video_url')?.video_url?.url ??
    msg?.content?.find?.((c: any) => c?.type === 'output_video')?.output_video?.url ??
    data?.data?.[0]?.url ??
    data?.url;

  if (!videoUrl) {
    throw new Error(`OpenRouter: no video URL in response`);
  }

  let bytes = 0;
  try {
    const head = await fetch(videoUrl, { method: 'HEAD' });
    bytes = Number(head.headers.get('content-length') ?? 0);
  } catch { /* best-effort */ }

  return { url: videoUrl, bytes, duration, aspectRatio };
}
