# Stage 2: Mobile Shell — Implementation Notes

## Summary

Added a mobile-first bottom tab navigation shell that makes palmkit.app usable on phones (< 640px viewport) while preserving the existing desktop experience unchanged.

---

## Files Changed

### New Files Created

| File | Purpose |
|------|---------|
| `app/components/mobile/MobileShell.tsx` | Main mobile shell: renders bottom tabs, spacer div for tab bar height, and quick actions overlay for the Actions tab |
| `app/components/mobile/MobileBottomTabs.tsx` | Bottom tab bar component with 5 tabs (Chat, Preview, Files, Actions, Settings). Hidden on desktop via `sm:hidden` CSS class |
| `app/lib/stores/mobile.ts` | `mobileActiveTab` Nanostore atom for tracking which tab is active on mobile |
| `app/styles/mobile.scss` | Mobile-specific CSS overrides (only apply at < 640px via `@media` queries) |

### Existing Files Modified

| File | Change | Why |
|------|--------|-----|
| `app/components/chat/BaseChat.tsx` | Added import for `MobileShell`; added `<ClientOnly>{() => <MobileShell />}</ClientOnly>` after `{baseChat}` inside the `<Tooltip.Provider>` wrapper | This is the safest insertion point: the MobileShell renders alongside the existing layout. It uses `ClientOnly` to avoid SSR issues. The existing desktop layout is completely untouched. |
| `app/styles/index.scss` | Added `@use 'mobile.scss'` import | Makes mobile CSS overrides available globally |

---

## How the Mobile Shell Is Activated

The mobile shell uses **CSS-only** for the show/hide mechanism. No JavaScript viewport detection is used in React render.

1. **`MobileBottomTabs`** uses the CSS class `sm:hidden` (UnoCSS/Tailwind utility). This means:
   - On viewports < 640px: the tab bar is visible (`display: flex`)
   - On viewports >= 640px: the tab bar is hidden (`display: none`)

2. **`MobileShell`** includes a spacer div with `sm:hidden` that adds 56px of bottom padding on mobile so content isn't hidden behind the tab bar.

3. **Tab state** is managed by the `mobileActiveTab` Nanostore atom. Tab clicks update this atom AND the shared `chatStore`/`workbenchStore` atoms to control which panel is visible.

4. **On first mount** on mobile, a `useEffect` in `MobileShell` checks `window.innerWidth < 640` (client-only, after mount, not in render) and sets initial state to show chat only.

5. **SSR Safety**: No `window` access in React render. The `ClientOnly` wrapper ensures `MobileShell` only renders on the client. The fallback (SSR) renders just the desktop layout. Since `MobileBottomTabs` uses `sm:hidden` CSS, even if the component renders on the server, it won't be visible on desktop viewports.

---

## What Components Are Reused

| Mobile Tab | Reused Component | How |
|-----------|-----------------|-----|
| Chat | Existing chat area in `BaseChat` | Tab click sets `chatStore.showChat = true` and `workbenchStore.showWorkbench = false`. The existing chat area takes full width on mobile. |
| Preview | Existing `Preview` inside `Workbench` | Tab click sets `workbenchStore.showWorkbench = true` and `workbenchStore.currentView = 'preview'`. The existing Workbench already goes full-width on small viewports. |
| Files | Existing `EditorPanel` + `FileTree` inside `Workbench` | Tab click sets `workbenchStore.currentView = 'code'`. Same Workbench reuse. |
| Actions | New quick action buttons | "Toggle Terminal" calls `workbenchStore.toggleTerminal()`. "Export ZIP" calls `workbenchStore.downloadZip()`. "Fix Error" and "Revert" are disabled placeholders. |
| Settings | Existing settings dialog via `useSettingsStore` | Tab click calls `useSettingsStore.getState().openSettings()`, which opens the existing settings modal. |

**Key insight**: We don't render any component twice. The mobile shell simply toggles the visibility of existing panels (chat, workbench) via shared Nanostores. The Workbench component already handles full-width layout on small viewports via its `useViewport(1024)` check.

---

## What Is Placeholder

1. **Actions tab — "Fix Current Error" button**: Disabled. Needs safe access to error state from `workbenchStore.actionAlert`. Marked as TODO.
2. **Actions tab — "Revert Last Change" button**: Disabled. Needs undo/history support in `workbenchStore`. Marked as TODO.
3. **Mobile CSS overrides**: The sidebar (`Menu.client.tsx`) is hidden via CSS `display: none !important` on mobile. This is a blunt approach; a better solution would be a slide-out drawer in a future stage.
4. **Tab sync**: When the Workbench close button (X) is clicked, the `MobileShell` syncs the active tab back to 'chat'. This works but relies on watching `workbenchStore.showWorkbench` changes, which could be triggered by other code too.

---

## Known Limitations

1. **Chat area does not scroll to bottom automatically on mobile tab switch**: When switching back to the Chat tab after being on Preview, the chat may not be scrolled to the latest message. This is a minor UX issue for a future stage.

2. **Workbench positioning uses `useViewport(1024)` not 640**: The existing Workbench uses a 1024px breakpoint for its mobile layout, while our tab bar uses 640px. On viewports between 640px and 1024px, the Workbench might not go full-width but the tab bar is already hidden. This is acceptable for the prototype.

3. **Bottom tab bar height (56px)**: The spacer div adds exactly 56px of bottom padding. This matches the tab bar height but does not account for varying safe area insets on all devices. The `env(safe-area-inset-bottom)` is used for the tab bar itself but not for the content spacer in all cases.

4. **No swipe gestures between tabs**: Switching tabs requires tapping the tab bar. Swipe gestures (e.g., swipe left to go from Chat to Preview) are not implemented.

5. **Settings tab opens the desktop settings dialog**: The existing settings dialog is designed for desktop. It may not be perfectly usable on mobile, but it works. A mobile-optimized settings view is planned for a future stage.

6. **Header is not optimized for mobile**: The header still shows all desktop buttons. A compact mobile header is planned for a future stage.

7. **The `mobile.scss` uses `!important` overrides**: This is necessary to override inline styles and higher-specificity selectors from the existing codebase, but it's not ideal. In future stages, we should refactor the original styles to be more responsive-friendly.

8. **Workbench bottom padding**: The `mobile.scss` adjusts the workbench's bottom offset to account for the tab bar, but this uses a CSS selector that targets the workbench's internal structure (`.z-workbench > div > div`). This is fragile and may break if the Workbench component structure changes.

---

## Rollback Instructions

To completely remove the mobile shell and restore the original palmkit.app:

1. **Delete the mobile components directory**:
   ```bash
   rm -rf app/components/mobile/
   ```

2. **Delete the mobile store**:
   ```bash
   rm app/lib/stores/mobile.ts
   ```

3. **Delete the mobile CSS**:
   ```bash
   rm app/styles/mobile.scss
   ```

4. **Revert `app/styles/index.scss`**: Remove the line `@use 'mobile.scss';`

5. **Revert `app/components/chat/BaseChat.tsx`**:
   - Remove the import: `import { MobileShell } from '~/components/mobile/MobileShell';`
   - Change the return statement back to:
     ```tsx
     return <Tooltip.Provider delayDuration={200}>{baseChat}</Tooltip.Provider>;
     ```
     (removing the `<ClientOnly>{() => <MobileShell />}</ClientOnly>` line)

These 5 steps restore the app to its original state. No other files were modified.

---

## Manual Test Notes

### Desktop (> 640px)
- [x] Landing page renders normally with "Where ideas begin" hero
- [x] Chat input is visible and functional
- [x] Model selector works
- [x] Settings dialog opens from header button
- [x] No bottom tab bar visible
- [x] No extra bottom padding
- [x] Workbench appears after sending a message

### Mobile (< 640px)
- [x] Bottom tab bar visible with 5 tabs: Chat, Preview, Files, Actions, Settings
- [x] Chat tab shows chat area full-width
- [x] Preview tab shows workbench in preview mode
- [x] Files tab shows workbench in code mode
- [x] Actions tab shows quick action buttons
- [x] Settings tab opens settings dialog
- [x] Tab highlights change correctly
- [x] Workbench X button returns to Chat tab (fixed in Stage 2.6: now also restores chatStore.showChat)
- [x] Safe area inset respected on iOS
- [x] Desktop state contamination fixed (Stage 2.6: matchMedia listener restores chatStore on resize)
- [x] Settings dialog responsive on mobile (Stage 2.6: full-screen CSS override)

### Hydration
- [x] No hydration errors in console
- [x] No `window.innerWidth` used in React render path
- [x] MobileShell wrapped in `ClientOnly`

### WebContainer / Provider / Streaming
- [x] No changes to WebContainer runtime
- [x] No changes to provider/model logic
- [x] No changes to AI streaming logic
- [x] No changes to message parser
- [x] No changes to system prompts
