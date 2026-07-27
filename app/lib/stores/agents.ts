import { atom } from 'nanostores';

/**
 * Agents (v3) — user control over the build pipeline.
 *
 * Palmkit builds with a multi-agent flow: Researcher → Planner → Builder →
 * Tester. Planner and Builder are the core (they design + write the app and
 * can't be turned off), but the two supporting agents are optional and trade
 * speed for thoroughness:
 *   • Researcher — reads the existing project before editing (only runs on
 *     edits anyway). Turning it off makes edits faster but less context-aware.
 *   • Tester — compiles the app, runs checks and screenshots after the build.
 *     Turning it off returns results sooner but skips verification.
 *
 * The choice rides to the worker in the job payload
 * (validation_result.agentConfig) and the orchestrator honours it.
 */
export interface AgentToggle {
  id: 'researcher' | 'tester';
  name: string;
  description: string;
  icon: string;
}

export const OPTIONAL_AGENTS: AgentToggle[] = [
  {
    id: 'researcher',
    name: 'Researcher',
    description: 'Reads your existing project before editing (edits only)',
    icon: 'i-ph:magnifying-glass',
  },
  {
    id: 'tester',
    name: 'Tester',
    description: 'Compiles, checks and screenshots the build to verify it works',
    icon: 'i-ph:check-circle',
  },
];

export interface AgentConfig {
  researcher: boolean;
  tester: boolean;
}

const KEY = 'palmkit_agent_config';
const DEFAULT: AgentConfig = { researcher: true, tester: true };

function read(): AgentConfig {
  if (typeof localStorage === 'undefined') {
    return { ...DEFAULT };
  }

  try {
    return { ...DEFAULT, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULT };
  }
}

export const agentConfigStore = atom<AgentConfig>(read());

export function toggleAgent(id: 'researcher' | 'tester') {
  const next = { ...agentConfigStore.get(), [id]: !agentConfigStore.get()[id] };
  agentConfigStore.set(next);

  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode */
  }
}

export function setAgentConfig(cfg: AgentConfig) {
  agentConfigStore.set(cfg);

  try {
    localStorage.setItem(KEY, JSON.stringify(cfg));
  } catch {
    /* private mode */
  }
}

/** Payload for the worker — only sent when it differs from the all-on default. */
export function getAgentConfigPayload(): AgentConfig | null {
  const cfg = agentConfigStore.get();
  return cfg.researcher && cfg.tester ? null : cfg;
}
