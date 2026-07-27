import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { streamText } from '~/lib/.server/llm/stream-text';
import type { ProviderInfo } from '~/types/model';
import { getApiKeysFromCookie, getProviderSettingsFromCookie } from '~/lib/api/cookies';
import { createScopedLogger } from '~/utils/logger';

export async function action(args: ActionFunctionArgs) {
  return clarifyAction(args);
}

const logger = createScopedLogger('api.clarify');

/*
 * Dynamic clarifier — the LLM analyzes the user's (short) prompt and returns
 * 2-5 clarifying questions, each with 3-5 clickable answer options that append
 * concrete spec to the prompt. Zero state on the server; the front-end calls
 * this once per short prompt, shows the sheet, and re-sends with the expanded
 * prompt.
 *
 * Distinct from the deleted prompt-enhancer: that replaced the user's text
 * (destructive, +30-220% tokens, degraded detailed prompts). This ADDS what
 * the user picks (constructive, ~600 tokens, only fires for short prompts).
 */
async function clarifyAction({ context, request }: ActionFunctionArgs) {
  const { message, model, provider } = await request.json<{
    message: string;
    model: string;
    provider: ProviderInfo;
  }>();

  const { name: providerName } = provider;

  if (!model || typeof model !== 'string') {
    throw new Response('Invalid or missing model', { status: 400, statusText: 'Bad Request' });
  }

  if (!providerName || typeof providerName !== 'string') {
    throw new Response('Invalid or missing provider', { status: 400, statusText: 'Bad Request' });
  }

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return Response.json({ questions: [] });
  }

  const cookieHeader = request.headers.get('Cookie');
  const apiKeys = getApiKeysFromCookie(cookieHeader);
  const providerSettings = getProviderSettingsFromCookie(cookieHeader);

  const systemPrompt = `You are Palmkit's clarification engine. A user typed a SHORT, vague build prompt. Your job: identify what's genuinely unspecified and ask 2-4 focused questions whose answers will make the build succeed on the first try.

Rules:
- Return ONLY valid JSON. No markdown, no backticks, no explanation.
- Schema: {"questions":[{"prompt":"<short question>","options":[{"label":"<2-4 words>","append":"<fragment to append to the prompt, e.g. ' with dark mode' — lowercase, starts with a space so it reads naturally when concatenated>"}]}]}
- Ask 2-4 questions (pick what's genuinely missing — never pad to hit a count).
- Each question has 3-5 options. Each option's "append" is a short fragment that reads naturally appended to the original prompt.
- Prefer concrete, build-relevant specs: features, design direction, data source, scope. Avoid vague options.
- Do NOT ask about the tech stack (Palmkit already picks React + Vite + Tailwind).
- Match the user's language: if the prompt is Arabic, write questions/options in Arabic; if English, English.
- If the prompt is already detailed enough, return {"questions":[]}.`;

  try {
    const result = await streamText({
      messages: [
        {
          role: 'user',
          content: `Analyze this build prompt and return clarifying questions as JSON.

<user_prompt>${message}</user_prompt>`,
        },
      ],
      env: context.cloudflare?.env as any,
      apiKeys,
      providerSettings,
      options: { system: systemPrompt },
    });

    // Collect the stream into a single string (the JSON response).
    let raw = '';
    const decoder = new TextDecoder();

    for await (const part of result.textStream) {
      raw += typeof part === 'string' ? part : decoder.decode(part as any);
    }

    // Robust JSON extraction (LLMs sometimes wrap in ```json or add prose).
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    let parsed: { questions?: Array<{ prompt: string; options: Array<{ label: string; append: string }> }> };

    try {
      parsed = JSON.parse(jsonMatch?.[0] ?? raw);
    } catch {
      logger.warn('Clarify JSON parse failed, returning empty', { raw: raw.slice(0, 200) });
      return Response.json({ questions: [] });
    }

    // Sanitize + cap to keep the UI tight.
    const questions = (parsed.questions ?? [])
      .filter((q) => q && typeof q.prompt === 'string' && Array.isArray(q.options))
      .slice(0, 5)
      .map((q) => ({
        prompt: q.prompt.slice(0, 120),
        options: q.options
          .filter((o) => o && typeof o.label === 'string' && typeof o.append === 'string')
          .slice(0, 5)
          .map((o) => ({ label: o.label.slice(0, 40), append: o.append.slice(0, 120) })),
      }))
      .filter((q) => q.options.length > 0);

    return Response.json({ questions });
  } catch (error: unknown) {
    logger.error('Clarify failed:', error);

    return Response.json({ questions: [], error: 'Clarification unavailable' }, { status: 200 });
  }
}
