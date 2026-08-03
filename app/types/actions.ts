import type { Change } from 'diff';

export type ActionType = 'file' | 'shell' | 'supabase' | 'asset' | 'edit';

export interface BaseAction {
  content: string;
}

export interface FileAction extends BaseAction {
  type: 'file';
  filePath: string;
}

export interface ShellAction extends BaseAction {
  type: 'shell';
}

export interface StartAction extends BaseAction {
  type: 'start';
}

export interface BuildAction extends BaseAction {
  type: 'build';
}

/**
 * A generated image or video, written into the project as a real file.
 *
 * `file` actions carry their content in the stream, which works for text and
 * cannot work for a JPEG: the bytes would have to be base64 in the response,
 * which is both enormous and goes back into the model's context.
 *
 * So this action carries a `src` — the storage link the generation tool
 * returned — and the browser fetches those bytes and writes them to the path.
 * The page then references `/assets/hero.jpg`, which survives the link
 * expiring, appears in an export, and works offline in the preview.
 */
export interface AssetAction extends BaseAction {
  type: 'asset';
  filePath: string;

  /** Where to fetch the bytes from. */
  src: string;
}

/**
 * Change part of an existing file, without rewriting it.
 *
 * A `file` action carries the finished file, so the smallest change the model
 * can express is the whole thing again. Measured on this app's own prompt:
 * changing one accent colour on a landing page cost 6,472 output tokens to
 * rewrite a 677-line file in which 68 lines differed — and the file came back
 * 76 lines longer, because a model asked for a colour rewrote the structure
 * around it. After prompt caching, output is roughly ninety percent of what a
 * turn costs, so this is the money and the risk in one place.
 *
 * The content is one or more search-and-replace blocks; see apply-edit.ts.
 */
export interface EditAction extends BaseAction {
  type: 'edit';
  filePath: string;
}

export interface SupabaseAction extends BaseAction {
  type: 'supabase';
  operation: 'migration' | 'query';
  filePath?: string;
  projectId?: string;
}

export type PalmkitAction =
  | FileAction
  | ShellAction
  | StartAction
  | BuildAction
  | SupabaseAction
  | AssetAction
  | EditAction;

export type PalmkitActionData = PalmkitAction | BaseAction;

export interface ActionAlert {
  type: string;
  title: string;
  description: string;
  content: string;
  source?: 'terminal' | 'preview'; // Add source to differentiate between terminal and preview errors
}

export interface SupabaseAlert {
  type: string;
  title: string;
  description: string;
  content: string;
  source?: 'supabase';
}

export interface DeployAlert {
  type: 'success' | 'error' | 'info';
  title: string;
  description: string;
  content?: string;
  url?: string;
  stage?: 'building' | 'deploying' | 'complete';
  buildStatus?: 'pending' | 'running' | 'complete' | 'failed';
  deployStatus?: 'pending' | 'running' | 'complete' | 'failed';
  source?: 'vercel' | 'netlify' | 'github' | 'gitlab';
}

export interface LlmErrorAlertType {
  type: 'error' | 'warning';
  title: string;
  description: string;
  content?: string;
  provider?: string;
  errorType?: 'authentication' | 'rate_limit' | 'quota' | 'network' | 'unknown';
}

export interface FileHistory {
  originalContent: string;
  lastModified: number;
  changes: Change[];
  versions: {
    timestamp: number;
    content: string;
  }[];

  // Novo campo para rastrear a origem das mudanças
  changeSource?: 'user' | 'auto-save' | 'external';
}
