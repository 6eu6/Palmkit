import type { FileMap } from '~/lib/stores/files';
import type { AgentTodoSnapshot, ReasoningEntry, ActivityGroup } from '~/lib/stores/build-status';

export interface Snapshot {
  chatIndex: string;
  files: FileMap;
  summary?: string;
  /*
   * Structured progress data — persisted so the user can refresh the page
   * mid-build (or after a build) and still see the Todos / Thought Process
   * / Activity Stream panels populated.
   *
   * Without persistence, these stores live only in nanostores (in-memory)
   * and disappear on page refresh — which made the user think the build was
   * "broken" because the panels would vanish.
   *
   * Populated by useChatHistory.ts snapshot save logic (reads from the
   * build-status stores at save time) and restored on chat load.
   */
  agentTodos?: Record<string, AgentTodoSnapshot>;
  reasoning?: ReasoningEntry[];
  activityGroups?: ActivityGroup[];
}

