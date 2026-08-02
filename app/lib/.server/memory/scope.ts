import type { SupabaseClient } from '@supabase/supabase-js';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('memory-scope');

export type MemoryMode = 'default' | 'project_only';

export interface MemoryScope {
  /** Project the conversation belongs to, if any. */
  folderId?: string;

  /** True when that project keeps its memory to itself. */
  projectOnly: boolean;
}

/**
 * Resolve which memory a conversation may read and write.
 *
 * The profile (`user_memory` / `folder_memory`) is the layer that actually
 * reaches the model — it is injected in full on every request — so this is
 * where the project setting has to bite. Scoping only `memory_facts` would
 * leave "Project-only" leaking the real memory and make the setting cosmetic.
 *
 *   default        read + write the GLOBAL profile, exactly as before. What
 *                  the project learns is visible outside it, and vice versa.
 *   project_only   read + write the project's OWN profile only. The global
 *                  profile is not injected, and nothing written here can be
 *                  seen from outside the project.
 */
export async function resolveMemoryScope(
  supabase: SupabaseClient,
  userId: string,
  folderId?: string | null,
): Promise<MemoryScope> {
  if (!folderId) {
    return { projectOnly: false };
  }

  const { data, error } = await supabase
    .from('folders')
    .select('memory_mode')
    .eq('user_id', userId)
    .eq('id', folderId)
    .maybeSingle();

  if (error) {
    /*
     * Missing column/table (migration 0016 not run yet) or a genuine failure.
     * Fall back to shared memory — the pre-projects behaviour — rather than
     * silently hiding the user's memory from them.
     */
    logger.warn(`Could not resolve project memory mode: ${error.message}`);
    return { folderId, projectOnly: false };
  }

  return { folderId, projectOnly: (data?.memory_mode as MemoryMode) === 'project_only' };
}

/** Read the profile for a scope. */
export async function readScopedProfile(supabase: SupabaseClient, userId: string, scope: MemoryScope): Promise<string> {
  try {
    if (scope.projectOnly && scope.folderId) {
      const { data } = await supabase
        .from('folder_memory')
        .select('content')
        .eq('user_id', userId)
        .eq('folder_id', scope.folderId)
        .maybeSingle();

      return data?.content || '';
    }

    const { data } = await supabase.from('user_memory').select('content').eq('user_id', userId).maybeSingle();

    return data?.content || '';
  } catch (err) {
    logger.warn(`Scoped profile read failed: ${err instanceof Error ? err.message : String(err)}`);
    return '';
  }
}

/** Write the profile for a scope. */
export async function writeScopedProfile(
  supabase: SupabaseClient,
  userId: string,
  scope: MemoryScope,
  content: string,
): Promise<void> {
  const lineCount = content.split('\n').filter((l) => l.trim()).length;
  const now = new Date().toISOString();

  const { error } =
    scope.projectOnly && scope.folderId
      ? await supabase
          .from('folder_memory')
          .upsert(
            { user_id: userId, folder_id: scope.folderId, content, line_count: lineCount, updated_at: now },
            { onConflict: 'user_id,folder_id' },
          )
      : await supabase
          .from('user_memory')
          .upsert({ user_id: userId, content, line_count: lineCount, updated_at: now }, { onConflict: 'user_id' });

  if (error) {
    logger.warn(`Scoped profile write failed: ${error.message}`);
  }
}
