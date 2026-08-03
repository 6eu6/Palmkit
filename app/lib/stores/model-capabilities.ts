import { atom, map } from 'nanostores';
import type { ModelDescriptor } from '~/lib/modules/llm/model-descriptor';
import { DEFAULT_EFFORT, type Effort } from '~/lib/modules/llm/effort';

/**
 * What the client knows about model capabilities, and how hard to think.
 *
 * Descriptors are fetched from the shared catalog rather than derived here:
 * the browser has no business guessing what a model can do when the server
 * has already established it.
 */

/** Keyed `provider::model`. */
export const descriptorsStore = map<Record<string, ModelDescriptor>>({});

export const descriptorsLoading = atom(false);

export function descriptorKey(provider: string, model: string): string {
  return `${provider}::${model}`;
}

export function getDescriptor(provider: string, model: string): ModelDescriptor | undefined {
  return descriptorsStore.get()[descriptorKey(provider, model)];
}

export async function loadDescriptors(provider?: string): Promise<void> {
  descriptorsLoading.set(true);

  try {
    const qs = provider ? `?provider=${encodeURIComponent(provider)}` : '';
    const res = await fetch(`/api/models/capabilities${qs}`, { credentials: 'same-origin' });

    if (!res.ok) {
      return;
    }

    const { descriptors } = (await res.json()) as { descriptors: ModelDescriptor[] };
    const next: Record<string, ModelDescriptor> = { ...descriptorsStore.get() };

    for (const d of descriptors) {
      next[descriptorKey(d.provider, d.model)] = d;
    }

    descriptorsStore.set(next);
  } catch {
    // Best effort: the UI degrades to "unknown capabilities", never breaks.
  } finally {
    descriptorsLoading.set(false);
  }
}

/**
 * Establish capabilities for a provider, probing what nothing else explains.
 *
 * Costs a fraction of a cent and a few seconds, so it is called when a user
 * connects or refreshes a provider — never on page load.
 */
export async function refreshProviderCapabilities(provider: string, models?: string[]): Promise<number> {
  descriptorsLoading.set(true);

  try {
    const res = await fetch('/api/models/capabilities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ provider, models, probe: true }),
    });

    if (!res.ok) {
      return 0;
    }

    const { descriptors } = (await res.json()) as { descriptors: ModelDescriptor[] };
    const next: Record<string, ModelDescriptor> = { ...descriptorsStore.get() };

    for (const d of descriptors) {
      next[descriptorKey(d.provider, d.model)] = d;
    }

    descriptorsStore.set(next);

    return descriptors.length;
  } catch {
    return 0;
  } finally {
    descriptorsLoading.set(false);
  }
}

/* ── Effort ───────────────────────────────────────────────────────────────── */

const EFFORT_KEY = 'palmkit_effort';

function initialEffort(): Effort {
  if (typeof localStorage === 'undefined') {
    return DEFAULT_EFFORT;
  }

  const saved = localStorage.getItem(EFFORT_KEY);

  return saved === 'fast' || saved === 'deep' || saved === 'balanced' ? saved : DEFAULT_EFFORT;
}

export const effortStore = atom<Effort>(initialEffort());

export function setEffort(effort: Effort) {
  effortStore.set(effort);

  try {
    localStorage.setItem(EFFORT_KEY, effort);
  } catch {
    // Private mode — the choice simply does not persist.
  }
}
