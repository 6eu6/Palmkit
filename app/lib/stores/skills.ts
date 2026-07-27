import { atom } from 'nanostores';

/**
 * Skills (v3 Phase 6).
 *
 * A Skill is a reusable instruction playbook — a named block of guidance that,
 * when enabled, is injected into the build models' context so every generation
 * follows it. Think "house rules" the models must honour (accessibility, SEO,
 * performance, a brand voice, a framework convention…).
 *
 * This is the concrete, shipping member of the "+" menu family. The siblings —
 * defined here so the product vocabulary is consistent — are:
 *   • Agents     — named sub-agent configs (role + model + tools) extending the
 *                  Researcher/Planner/Builder/Tester pipeline.
 *   • Workflows  — saved multi-step sequences (build → test → deploy → export)
 *                  runnable as one action.
 *   • Libraries  — saved reusable assets (snippets, components, tokens, docs)
 *                  that Skills and Builders can pull from.
 *
 * Enabled skills flow to the worker exactly like the model-router / reasoning
 * settings: their instructions ride along in the job payload
 * (validation_result.skills) and the orchestrator injects them into the
 * Planner/Builder prompt.
 */
export interface Skill {
  id: string;
  name: string;

  /** One-line description shown in the picker. */
  description: string;

  /** Phosphor icon class, e.g. 'i-ph:wheelchair'. */
  icon: string;

  /** The actual guidance injected into the model context when enabled. */
  instructions: string;

  /** Built-in skills ship with Palmkit; user skills are created in the panel. */
  builtin: boolean;
}

/** Curated, dev-focused starter skills. */
export const BUILTIN_SKILLS: Skill[] = [
  {
    id: 'a11y',
    name: 'Accessibility',
    description: 'WCAG-minded semantic HTML, ARIA, keyboard & contrast',
    icon: 'i-ph:wheelchair',
    builtin: true,
    instructions:
      'Accessibility is a hard requirement. Use semantic HTML elements (nav, main, header, button, etc.). Every interactive element must be keyboard-operable and focus-visible. Provide alt text for images and aria-labels for icon-only controls. Maintain WCAG AA colour contrast. Do not rely on colour alone to convey meaning.',
  },
  {
    id: 'seo',
    name: 'SEO',
    description: 'Meta tags, semantic structure, Open Graph, sitemaps',
    icon: 'i-ph:magnifying-glass',
    builtin: true,
    instructions:
      'Optimise for search engines: a single descriptive <h1>, a logical heading hierarchy, a unique <title> and meta description per page, Open Graph and Twitter card tags, semantic landmarks, and descriptive link text. Prefer server-rendered/static content for indexable pages.',
  },
  {
    id: 'responsive',
    name: 'Responsive-first',
    description: 'Mobile-first, fluid layouts, no fixed widths',
    icon: 'i-ph:devices',
    builtin: true,
    instructions:
      'Design mobile-first. Use fluid, flexbox/grid layouts with relative units; never hard-code pixel widths that break on small screens. Verify layouts at 375px, 768px and 1280px. Tap targets must be at least 44px. Images use max-width:100% and never cause horizontal scroll.',
  },
  {
    id: 'performance',
    name: 'Performance',
    description: 'Lean deps, lazy-loading, optimized assets',
    icon: 'i-ph:gauge',
    builtin: true,
    instructions:
      'Keep the bundle lean: avoid heavy dependencies when a small amount of code will do. Lazy-load below-the-fold and route-level content. Use appropriately sized images with width/height set to avoid layout shift. Avoid blocking the main thread with large synchronous work.',
  },
  {
    id: 'clean-code',
    name: 'Clean code',
    description: 'Typed, small components, clear names, no dead code',
    icon: 'i-ph:broom',
    builtin: true,
    instructions:
      'Write clean, typed code. Prefer small, single-purpose components and functions with descriptive names. Use TypeScript types over any. Do not leave commented-out or dead code. Keep files focused and consistent with the surrounding conventions.',
  },
];

const STORAGE_KEY = 'palmkit_skills';
const ENABLED_KEY = 'palmkit_skills_enabled';

function readUserSkills(): Skill[] {
  if (typeof localStorage === 'undefined') {
    return [];
  }

  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function readEnabled(): string[] {
  if (typeof localStorage === 'undefined') {
    return [];
  }

  try {
    const raw = JSON.parse(localStorage.getItem(ENABLED_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

/** All skills = built-ins + user-defined. */
export const userSkillsStore = atom<Skill[]>(readUserSkills());

/** Set of enabled skill ids. */
export const enabledSkillsStore = atom<string[]>(readEnabled());

export function allSkills(): Skill[] {
  return [...BUILTIN_SKILLS, ...userSkillsStore.get()];
}

export function toggleSkill(id: string) {
  const current = enabledSkillsStore.get();
  const next = current.includes(id) ? current.filter((s) => s !== id) : [...current, id];
  enabledSkillsStore.set(next);

  try {
    localStorage.setItem(ENABLED_KEY, JSON.stringify(next));
  } catch {
    /* private mode */
  }
}

export function addUserSkill(skill: Omit<Skill, 'id' | 'builtin'>) {
  const id = `user-${Date.now().toString(36)}`;
  const next = [...userSkillsStore.get(), { ...skill, id, builtin: false }];
  userSkillsStore.set(next);

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* private mode */
  }

  return id;
}

export function removeUserSkill(id: string) {
  userSkillsStore.set(userSkillsStore.get().filter((s) => s.id !== id));

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(userSkillsStore.get()));
  } catch {
    /* private mode */
  }

  // also drop from enabled
  const enabled = enabledSkillsStore.get();

  if (enabled.includes(id)) {
    toggleSkill(id);
  }
}

/**
 * The payload sent to the worker: enabled skills as `{ name, instructions }`.
 * Mirrors how modelRoles / reasoningEffort are attached to a job.
 */
export function getActiveSkillPayload(): { name: string; instructions: string }[] {
  const enabled = new Set(enabledSkillsStore.get());
  return allSkills()
    .filter((s) => enabled.has(s.id))
    .map((s) => ({ name: s.name, instructions: s.instructions }));
}
