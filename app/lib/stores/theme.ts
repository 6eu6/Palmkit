import { atom } from 'nanostores';
import { logStore } from './logs';

// Migration: move old bolt_* localStorage keys to palmkit_*
function migrateBoltLocalStorageKeys() {
  const migrations: Record<string, string> = {
    bolt_tab_configuration: 'palmkit_tab_configuration',
    bolt_theme: 'palmkit_theme',
    bolt_user_profile: 'palmkit_user_profile',
    bolt_profile: 'palmkit_profile',
    bolt_read_logs: 'palmkit_read_logs',
    'bolt-deleted-paths': 'palmkit-deleted-paths',
    bolt_current_model: 'palmkit_current_model',
    bolt_current_provider: 'palmkit_current_provider',
    bolt_project_type: 'palmkit_project_type',
    bolt_git_info: 'palmkit_git_info',
    bolt_viewed_features: 'palmkit_viewed_features',
    bolt_acknowledged_connection_issue: 'palmkit_acknowledged_connection_issue',
    'bolt.lockedFiles': 'palmkit.lockedFiles',
    bolt_settings: 'palmkit_settings',
    bolt_developer_mode: 'palmkit_developer_mode',
    bolt_acknowledged_debug_issues: 'palmkit_acknowledged_debug_issues',
    bolt_last_acknowledged_version: 'palmkit_last_acknowledged_version',
    bolt_chat_history: 'palmkit_chat_history',
  };

  for (const [oldKey, newKey] of Object.entries(migrations)) {
    const oldValue = localStorage.getItem(oldKey);

    if (oldValue !== null && localStorage.getItem(newKey) === null) {
      localStorage.setItem(newKey, oldValue);
      localStorage.removeItem(oldKey);
    }
  }
}

// Run migration on module load
if (typeof window !== 'undefined') {
  migrateBoltLocalStorageKeys();
}

export type Theme = 'dark' | 'light';

export const kTheme = 'palmkit_theme';

export function themeIsDark() {
  return themeStore.get() === 'dark';
}

export const DEFAULT_THEME = 'dark';

export const themeStore = atom<Theme>(initStore());

function initStore() {
  if (!import.meta.env.SSR) {
    const persistedTheme = localStorage.getItem(kTheme) as Theme | undefined;
    const themeAttribute = document.querySelector('html')?.getAttribute('data-theme');

    return persistedTheme ?? (themeAttribute as Theme) ?? DEFAULT_THEME;
  }

  return DEFAULT_THEME;
}

export function toggleTheme() {
  const currentTheme = themeStore.get();
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';

  // Update the theme store
  themeStore.set(newTheme);

  // Update localStorage
  localStorage.setItem(kTheme, newTheme);

  // Update the HTML attribute
  document.querySelector('html')?.setAttribute('data-theme', newTheme);

  // Update user profile if it exists
  try {
    const userProfile = localStorage.getItem('palmkit_user_profile');

    if (userProfile) {
      const profile = JSON.parse(userProfile);
      profile.theme = newTheme;
      localStorage.setItem('palmkit_user_profile', JSON.stringify(profile));
    }
  } catch (error) {
    console.error('Error updating user profile theme:', error);
  }

  logStore.logSystem(`Theme changed to ${newTheme} mode`);
}
