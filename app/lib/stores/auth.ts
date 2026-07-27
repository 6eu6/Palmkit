import { atom } from 'nanostores';

export interface AuthUser {
  id: string;
  email?: string;
  name?: string;
  avatarUrl?: string;
}

/** Current signed-in user (hydrated from the root loader), or null. */
export const authUserStore = atom<AuthUser | null>(null);

/** Whether Supabase auth is configured on the server (gates UI that needs it). */
export const authEnabledStore = atom<boolean>(false);

/** Controls the global "sign in to continue" modal. */
export const authModalStore = atom<boolean>(false);

export function openAuthModal() {
  authModalStore.set(true);
}

export function closeAuthModal() {
  authModalStore.set(false);
}

/**
 * Returns true if a user is signed in. Otherwise opens the auth modal (when
 * auth is enabled) and returns false. Used to gate the prompt input.
 */
export function ensureSignedIn(): boolean {
  if (authUserStore.get()) {
    return true;
  }

  // If auth isn't configured on the server, don't block the user.
  if (!authEnabledStore.get()) {
    return true;
  }

  authModalStore.set(true);

  return false;
}
