import { atom } from 'nanostores';

/**
 * Libraries (v3) — reusable reference material.
 *
 * Where a Skill is a *rule* the models must follow, a Library item is
 * *reference material* the Builder can draw on: a code snippet, a design-token
 * set, an API contract, a copy/brand doc, a component you always reuse. Enabled
 * items are injected into the build context as reference (not commands), so the
 * generated app can pull from them.
 *
 * Wired exactly like Skills: enabled items ride in the job payload
 * (validation_result.libraries) and the orchestrator appends them to the
 * Builder prompt under a REFERENCE LIBRARY block.
 */
export interface LibraryItem {
  id: string;
  name: string;

  /** e.g. 'snippet' | 'tokens' | 'doc' — free-form label shown as a chip. */
  kind: string;

  /** The reference content injected when enabled. */
  content: string;
}

const STORE_KEY = 'palmkit_libraries';
const ENABLED_KEY = 'palmkit_libraries_enabled';

function readItems(): LibraryItem[] {
  if (typeof localStorage === 'undefined') {
    return [];
  }

  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
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

export const librariesStore = atom<LibraryItem[]>(readItems());
export const enabledLibrariesStore = atom<string[]>(readEnabled());

export function toggleLibrary(id: string) {
  const cur = enabledLibrariesStore.get();
  const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
  enabledLibrariesStore.set(next);

  try {
    localStorage.setItem(ENABLED_KEY, JSON.stringify(next));
  } catch {
    /* private mode */
  }
}

export function addLibraryItem(item: Omit<LibraryItem, 'id'>) {
  const id = `lib-${Date.now().toString(36)}`;
  const next = [...librariesStore.get(), { ...item, id }];
  librariesStore.set(next);

  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(next));
  } catch {
    /* private mode */
  }

  return id;
}

export function removeLibraryItem(id: string) {
  librariesStore.set(librariesStore.get().filter((x) => x.id !== id));

  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(librariesStore.get()));
  } catch {
    /* private mode */
  }

  if (enabledLibrariesStore.get().includes(id)) {
    toggleLibrary(id);
  }
}

/** Payload for the worker: enabled items as `{ name, kind, content }`. */
export function getActiveLibraryPayload(): { name: string; kind: string; content: string }[] {
  const enabled = new Set(enabledLibrariesStore.get());
  return librariesStore
    .get()
    .filter((x) => enabled.has(x.id))
    .map((x) => ({ name: x.name, kind: x.kind, content: x.content }));
}
