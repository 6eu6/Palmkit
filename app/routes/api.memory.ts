/**
 * /api/memory — memory management endpoint.
 *
 * GET: Retrieve user profile + relevant facts for system prompt injection.
 *   Query: ?query=<user message>&mode=chat
 *   Returns: { profile: string, facts: RetrievedFact[] }
 *
 * POST: Trigger async memory extraction after a conversation turn.
 *   Body: { messages: Message[], conversationId?: string, mode: string }
 *   Returns: { ok: boolean, operations: number }
 *
 * DELETE: Clear all memory for the current user.
 *   Returns: { ok: boolean }
 */

import { type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { getAuthedUser } from '~/lib/auth/supabase.server';
import { createScopedLogger } from '~/utils/logger';
import { retrieveRelevantFacts, formatFactsForInjection, buildMemoryBlock } from '~/lib/.server/memory/retriever';
import { extractMemoryOperations } from '~/lib/.server/memory/extractor';
import { storeFact, extractFactsFromMemory } from '~/lib/.server/memory/store';
import { readScopedProfile, resolveMemoryScope, writeScopedProfile } from '~/lib/.server/memory/scope';

const logger = createScopedLogger('api.memory');

function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};

  cookieHeader
    .split(';')
    .map((c) => c.trim())
    .forEach((item) => {
      const [name, ...rest] = item.split('=');

      if (name && rest) {
        cookies[decodeURIComponent(name.trim())] = decodeURIComponent(rest.join('=').trim());
      }
    });

  return cookies;
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const authed = await getAuthedUser(request, context);

  if (!authed?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const query = url.searchParams.get('query') || '';
  const mode = url.searchParams.get('mode') || undefined;
  const folderId = url.searchParams.get('folderId') || undefined;

  // Parse API keys from cookies
  const cookieHeader = request.headers.get('Cookie') || '';
  let apiKeys: Record<string, string> = {};

  try {
    apiKeys = JSON.parse(parseCookies(cookieHeader).apiKeys || '{}');
  } catch {
    /* ignore */
  }

  /*
   * Which memory this conversation may see. A project set to "Project-only"
   * reads its OWN profile and never the global one — that is what makes the
   * setting real rather than decorative.
   */
  const scope = await resolveMemoryScope(authed!.supabase, authed!.user!.id, folderId);

  // Layer 1: the profile (always injected in full)
  const profile = await readScopedProfile(authed!.supabase, authed!.user!.id, scope);

  // Layer 3: relevant facts via hybrid search, scoped the same way
  const facts = query
    ? await retrieveRelevantFacts(authed!.supabase, authed!.user!.id, query, apiKeys, 5, mode, scope)
    : [];

  const factsText = formatFactsForInjection(facts);

  /*
   * The project's standing instructions ride along with the memory block,
   * which api.chat already injects into the system prompt. That is the whole
   * point of writing them once: every conversation in the project starts
   * knowing the brief instead of being told again.
   */
  const memoryBlock = [
    scope.instructions ? `<project_instructions>\n${scope.instructions.trim()}\n</project_instructions>` : '',
    buildMemoryBlock(profile, factsText),
  ]
    .filter(Boolean)
    .join('\n\n');

  return Response.json({
    profile,
    facts,
    memoryBlock,
  });
}

export async function action({ request, context }: ActionFunctionArgs) {
  const authed = await getAuthedUser(request, context);

  if (!authed?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (request.method === 'POST') {
    if (!authed) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    return handleExtraction(authed, request);
  }

  if (request.method === 'DELETE') {
    if (!authed) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    return handleClear(authed);
  }

  return Response.json({ error: 'Method not allowed' }, { status: 405 });
}

async function handleExtraction(authed: any, request: Request) {
  const body = await request.json<{
    messages: Array<{ role: string; content: string }>;
    conversationId?: string;
    mode?: string;
    folderId?: string;
  }>();

  if (!body.messages || body.messages.length === 0) {
    return Response.json({ ok: true, operations: 0 });
  }

  // Parse API keys
  const cookieHeader = request.headers.get('Cookie') || '';
  let apiKeys: Record<string, string> = {};

  try {
    apiKeys = JSON.parse(parseCookies(cookieHeader).apiKeys || '{}');
  } catch {
    /* ignore */
  }

  /*
   * Read AND write the same scope: what a Project-only conversation learns
   * stays in that project's profile, so it can never surface in an outside
   * chat. A Default project reads and writes the global profile, so the two
   * directions stay shared exactly as before projects existed.
   */
  const scope = await resolveMemoryScope(authed!.supabase, authed!.user!.id, body.folderId);
  const currentMemory = await readScopedProfile(authed!.supabase, authed!.user!.id, scope);

  // Extract operations
  const result = await extractMemoryOperations(currentMemory, body.messages, apiKeys);

  if (!result.changed) {
    return Response.json({
      ok: true,
      operations: 0,
      debug: {
        apiKeyFound: !!apiKeys.OpenRouter,
        currentMemory: currentMemory.slice(0, 100),
        messageCount: body.messages.length,
        operationsReturned: result.operations.length,
      },
    });
  }

  // Save updated profile (Layer 1) into the resolved scope
  await writeScopedProfile(authed!.supabase, authed!.user!.id, scope, result.newMemory);

  // Extract and store facts (Layer 3)
  const facts = extractFactsFromMemory(result.newMemory);
  const mode = body.mode || 'chat';

  for (const fact of facts) {
    await storeFact(
      authed!.supabase,
      authed!.user!.id,
      fact.key,
      fact.value,
      mode,
      body.conversationId,
      apiKeys,
      scope.projectOnly ? scope.folderId : undefined,
    );
  }

  logger.info(`Memory extraction complete: ${result.operations.length} ops, ${facts.length} facts stored`);

  return Response.json({
    ok: true,
    operations: result.operations.length,
    factsStored: facts.length,
  });
}

async function handleClear(authed: any) {
  // Clear Layer 1
  await authed!.supabase.from('user_memory').delete().eq('user_id', authed!.user!.id);

  // Clear per-project profiles too, or "clear memory" would leave them behind
  await authed!.supabase.from('folder_memory').delete().eq('user_id', authed!.user!.id);

  // Clear Layer 3
  await authed!.supabase.from('memory_facts').delete().eq('user_id', authed!.user!.id);

  logger.info(`Memory cleared for user ${authed!.user!.id}`);

  return Response.json({ ok: true });
}
