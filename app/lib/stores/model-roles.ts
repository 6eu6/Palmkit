import { atom, map } from 'nanostores';
import type { ModelCapability } from '~/lib/modules/llm/capabilities';

/**
 * Model Router (Design v2) — one model per JOB, not one model for everything.
 *
 * Roles:
 *   brain   — planning/orchestration/research: the smartest model you have
 *   builder — the sub-agents writing code: smart but cheaper/faster
 *   tester  — verification/security/visual checks
 *   vision  — design/visual reasoning (logo suggestions, screenshot review)
 *   media   — image/video generation (hero videos, animated assets)
 *
 * An empty value means "use the main selected model" — so the router is
 * strictly opt-in and the old single-model behavior stays the default.
 * vision/media are stored now and consumed as those pipelines land.
 */
export type ModelRole = 'brain' | 'builder' | 'tester' | 'vision' | 'media';

export type ReasoningEffort = 'off' | 'medium' | 'max';

/**
 * Capability requirement for each role.
 *
 * - brain:   needs reasoning (smartest model). No text fallback — only
 *            reasoning models appear. If none available, "Main model" is used.
 * - builder: needs code (code-capable). Reasoning models also accepted.
 * - tester:  needs code (verification). Reasoning models also accepted.
 * - vision:  needs vision (multimodal input). No text fallback.
 * - media:   needs image OR video (output generation). No text fallback.
 *
 * `allowTextFallback` is false for all roles — this ensures each dropdown
 * shows ONLY specialized models, not the hundreds of general text models.
 * Users who don't have a specialized model can always pick "Main model".
 */
export interface RoleCapabilitySpec {
  /** Required capability (model must support this). */
  primary: ModelCapability;

  /** Secondary capability (also acceptable, shown in "compatible" group). */
  secondary?: ModelCapability;

  /** Whether general text models are also acceptable (default: false). */
  allowTextFallback: boolean;
}

export const ROLE_CAPABILITY_SPEC: Record<ModelRole, RoleCapabilitySpec> = {
  brain: { primary: 'reasoning', allowTextFallback: false },
  builder: { primary: 'code', secondary: 'reasoning', allowTextFallback: false },
  tester: { primary: 'code', secondary: 'reasoning', allowTextFallback: false },
  vision: { primary: 'vision', allowTextFallback: false },
  media: { primary: 'image', secondary: 'video', allowTextFallback: false },
};

export const MODEL_ROLE_META: Record<ModelRole, { label: string; hint: string; wired: boolean }> = {
  brain: { label: 'Brain · Planning', hint: 'Orchestrates & plans — use your smartest model', wired: true },
  builder: { label: 'Builder agents', hint: 'Writes the code — fast + capable', wired: true },
  tester: { label: 'Tester · Checks', hint: 'Build verification, security & QA', wired: true },
  vision: { label: 'Vision · Design', hint: 'Visual reasoning & design review', wired: true },
  media: { label: 'Media · Image/Video', hint: 'Generates images & video assets', wired: true },
};

const ROLES_KEY = 'palmkit_model_roles';
const EFFORT_KEY = 'palmkit_reasoning_effort';

function readRoles(): Partial<Record<ModelRole, string>> {
  if (typeof localStorage === 'undefined') {
    return {};
  }

  try {
    return JSON.parse(localStorage.getItem(ROLES_KEY) || '{}');
  } catch {
    return {};
  }
}

export const modelRolesStore = map<Partial<Record<ModelRole, string>>>(readRoles());

export function setModelRole(role: ModelRole, model: string) {
  if (model) {
    modelRolesStore.setKey(role, model);
  } else {
    modelRolesStore.setKey(role, undefined);
  }

  try {
    localStorage.setItem(ROLES_KEY, JSON.stringify(modelRolesStore.get()));
  } catch {
    /* private mode */
  }
}

export const reasoningEffortStore = atom<ReasoningEffort>(
  typeof localStorage !== 'undefined' ? ((localStorage.getItem(EFFORT_KEY) as ReasoningEffort) ?? 'medium') : 'medium',
);

export function setReasoningEffort(effort: ReasoningEffort) {
  reasoningEffortStore.set(effort);

  try {
    localStorage.setItem(EFFORT_KEY, effort);
  } catch {
    /* private mode */
  }
}

export function cycleReasoningEffort(): ReasoningEffort {
  const order: ReasoningEffort[] = ['medium', 'max', 'off'];
  const next = order[(order.indexOf(reasoningEffortStore.get()) + 1) % order.length];
  setReasoningEffort(next);

  return next;
}

/** Ordered levels for the "thinking power" meter, low → high. */
export const REASONING_LEVELS: { value: ReasoningEffort; label: string; hint: string }[] = [
  { value: 'off', label: 'Off', hint: 'No extended thinking — fastest, cheapest' },
  { value: 'medium', label: 'Medium', hint: 'Balanced reasoning for most tasks' },
  { value: 'max', label: 'Max', hint: 'Deepest reasoning — best for hard problems' },
];
