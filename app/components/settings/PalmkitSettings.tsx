import { useStore } from '@nanostores/react';
import { Form } from '@remix-run/react';
import { useState } from 'react';
import { authUserStore } from '~/lib/stores/auth';
import { profileStore } from '~/lib/stores/profile';
import { themeStore, toggleTheme } from '~/lib/stores/theme';
import { useSettingsStore } from '~/lib/stores/settings';
import { mobileActiveTab } from '~/lib/stores/mobile';
import { SettingsGroup, SettingsRow, SettingsSheet, type SettingsNav, type SettingsPage } from './SettingsSheet';
import { providersPage } from './pages/ProvidersPage';
import { modelAssignmentsPage } from './pages/ModelAssignmentsPage';

/**
 * Everything settings, in one sheet.
 *
 * The account sheet's "Settings" row used to open a separate thirteen-tab
 * control panel — settings opening settings, in a different shape, somewhere
 * else on screen. Sections now push a page onto the same sheet.
 *
 * The old panel is still reachable while its tabs are migrated across, but as
 * an explicitly-labelled Advanced row rather than as the thing the obvious
 * button does.
 */

function RootPage({ nav }: { nav: SettingsNav }) {
  const authUser = useStore(authUserStore);
  const profile = useStore(profileStore);
  const theme = useStore(themeStore);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const displayName = profile?.username || authUser?.email?.split('@')[0] || 'Account';
  const initials = displayName.slice(0, 2).toUpperCase();

  return (
    <>
      <div className="mb-7 flex flex-col items-center">
        <span className="flex h-20 w-20 items-center justify-center rounded-full bg-palmkit-elements-background-depth-3 text-[24px] font-semibold text-palmkit-elements-textPrimary">
          {initials}
        </span>
        <div className="mt-3 text-[20px] font-semibold text-palmkit-elements-textPrimary">{displayName}</div>
      </div>

      <SettingsGroup title="Palmkit">
        <SettingsRow
          first
          icon="i-ph:key"
          label="Model providers"
          sub="API keys and what each model can do"
          chevron
          onClick={() => nav.push(providersPage())}
        />
        <SettingsRow
          icon="i-ph:sliders-horizontal"
          label="Model assignment"
          sub="Which model draws, which renders video"
          chevron
          onClick={() => nav.push(modelAssignmentsPage())}
        />
        <SettingsRow
          icon="i-ph:plugs-connected"
          label="Connectors"
          sub="Coming next"
          right={
            <span className="rounded-full bg-palmkit-elements-background-depth-3 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-palmkit-elements-textTertiary">
              Soon
            </span>
          }
        />
      </SettingsGroup>

      <SettingsGroup title="Account">
        {authUser?.email && <SettingsRow first icon="i-ph:envelope-simple" label="Email" sub={authUser.email} />}
        <SettingsRow
          first={!authUser?.email}
          icon="i-ph:plus-square"
          label="Subscription"
          right={<span className="text-[15px] text-palmkit-elements-textTertiary">Free</span>}
        />
      </SettingsGroup>

      <SettingsGroup title="Preferences">
        <SettingsRow
          first
          icon={theme === 'dark' ? 'i-ph:moon' : 'i-ph:sun'}
          label="Appearance"
          onClick={toggleTheme}
          right={<span className="text-[15px] capitalize text-palmkit-elements-textTertiary">{theme}</span>}
        />
        <SettingsRow
          icon="i-ph:sliders-horizontal"
          label="Advanced"
          sub="MCP, integrations, diagnostics"
          chevron
          onClick={() => {
            nav.close();
            mobileActiveTab.set('settings');
            useSettingsStore.getState().openSettings();
          }}
        />
      </SettingsGroup>

      <SettingsGroup title="Data">
        <SettingsRow first icon="i-ph:download-simple" label="Export my data" chevron href="/api/account/export" />
      </SettingsGroup>

      <SettingsGroup>
        <Form method="post" action="/logout">
          <SettingsRow first submit icon="i-ph:sign-out" label="Log out" />
        </Form>
        {!confirmingDelete ? (
          <SettingsRow icon="i-ph:trash" label="Delete account" danger onClick={() => setConfirmingDelete(true)} />
        ) : (
          <div className="border-t border-palmkit-elements-borderColor/60 px-4 py-3.5">
            <p className="mb-3 text-[13px] leading-relaxed text-palmkit-elements-textTertiary">
              Permanently deletes your account, projects and stored key. Cannot be undone.
            </p>
            <div className="flex gap-2">
              <Form method="post" action="/api/account/delete" className="flex-1">
                <button
                  type="submit"
                  className="h-11 w-full rounded-full bg-red-600 text-[15px] font-semibold text-white transition active:scale-[0.98]"
                >
                  Delete
                </button>
              </Form>
              <button
                onClick={() => setConfirmingDelete(false)}
                className="h-11 flex-1 rounded-full bg-palmkit-elements-background-depth-3 text-[15px] font-semibold text-palmkit-elements-textPrimary transition active:scale-[0.98]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </SettingsGroup>
    </>
  );
}

export function PalmkitSettings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const root: SettingsPage = {
    id: 'root',
    title: 'Settings',
    render: (nav) => <RootPage nav={nav} />,
  };

  return <SettingsSheet open={open} onClose={onClose} root={root} />;
}
