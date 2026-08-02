import { ClientOnly } from 'remix-utils/client-only';
import { Menu } from '~/components/sidebar/Menu.client';
import { MobileShell } from '~/components/mobile/MobileShell';

/**
 * App chrome that must OUTLIVE the conversation it sits next to.
 *
 * The desktop sidebar and the mobile projects drawer used to render inside
 * `BaseChat`, which renders inside `<ChatImpl key={`${tab}-${chatId}`}>`. That
 * key intentionally remounts the whole chat tree when the user switches
 * between Chat/Work/Code — so the sidebar was destroyed and rebuilt on every
 * tab switch. React mounted it fresh with the store's `open` value, framer
 * replayed the slide-in, the history list started empty and re-queried
 * IndexedDB, and the mobile drawer closed and re-opened itself. That is the
 * "the sidebar reopens instead of staying open, and everything flashes"
 * behaviour.
 *
 * Rendering the chrome here — a sibling of the keyed subtree, mounted by the
 * route layout — means a tab switch swaps only the conversation. The sidebar
 * keeps its DOM, its scroll position and its open state, and nothing animates
 * that the user didn't ask for.
 */
export function PersistentChrome() {
  return (
    <>
      <ClientOnly>{() => <Menu />}</ClientOnly>
      <ClientOnly>{() => <MobileShell />}</ClientOnly>
    </>
  );
}
