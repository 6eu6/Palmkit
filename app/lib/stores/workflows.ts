import { atom } from 'nanostores';
import { enabledSkillsStore } from './skills';
import { setAgentConfig } from './agents';

/**
 * Workflows (v3) — one-tap presets that set the whole build up.
 *
 * A Workflow bundles the settings you'd otherwise toggle by hand — which
 * Skills to enable, the agent pipeline, and a prompt scaffold — behind a single
 * choice. Picking "Landing page" turns on the SEO / Responsive / Performance
 * skills, keeps full verification on, and drops a structured brief into the
 * composer. This is a client-side convenience that composes the other
 * primitives; nothing new is sent to the worker beyond what the Skills / Agents
 * settings it applies already send.
 */
export interface Workflow {
  id: string;
  name: string;
  description: string;
  icon: string;

  /** Skill ids to enable when this workflow is applied. */
  skills: string[];

  /** Agent pipeline for this workflow. */
  agents: { researcher: boolean; tester: boolean };

  /** A prompt scaffold dropped into the composer for the user to fill in. */
  scaffold: string;
}

export const BUILTIN_WORKFLOWS: Workflow[] = [
  {
    id: 'landing',
    name: 'Landing page',
    description: 'Marketing page — SEO, responsive, fast',
    icon: 'i-ph:rocket-launch',
    skills: ['seo', 'responsive', 'performance'],
    agents: { researcher: true, tester: true },
    scaffold:
      'Build a landing page for [product].\n- Hero with headline, subhead and primary CTA\n- 3 feature highlights\n- Social proof / testimonials\n- Pricing\n- Footer with links\nBrand tone: [tone]. Primary colour: [hex].',
  },
  {
    id: 'webapp',
    name: 'Web app',
    description: 'Interactive app — accessible & clean',
    icon: 'i-ph:app-window',
    skills: ['a11y', 'clean-code', 'responsive'],
    agents: { researcher: true, tester: true },
    scaffold:
      'Build a [type] web app.\nCore features:\n- [feature 1]\n- [feature 2]\n- [feature 3]\nData: [persist in localStorage / none]. Keep the UI accessible and responsive.',
  },
  {
    id: 'prototype',
    name: 'Quick prototype',
    description: 'Fast draft — verification off for speed',
    icon: 'i-ph:lightning',
    skills: [],
    agents: { researcher: false, tester: false },
    scaffold: 'Quickly prototype [idea]. Keep it minimal — one screen, no backend.',
  },
];

/** The workflow currently applied (for highlighting), or null. */
export const activeWorkflowStore = atom<string | null>(null);

/**
 * Apply a workflow: enable its skills, set its agent pipeline, and return its
 * scaffold so the caller can drop it into the composer.
 */
export function applyWorkflow(id: string): string | null {
  const wf = BUILTIN_WORKFLOWS.find((w) => w.id === id);

  if (!wf) {
    return null;
  }

  enabledSkillsStore.set([...wf.skills]);

  try {
    localStorage.setItem('palmkit_skills_enabled', JSON.stringify(wf.skills));
  } catch {
    /* private mode */
  }

  setAgentConfig({ ...wf.agents });
  activeWorkflowStore.set(id);

  return wf.scaffold;
}
