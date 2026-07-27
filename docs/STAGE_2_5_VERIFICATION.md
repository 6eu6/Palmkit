# Stage 2.5: Mobile Shell — Verification Report

**Date:** 2026-06-14
**Original Verdict:** PASS WITH FIXES
**Status:** All bugs fixed in Stage 2.6. See `docs/STAGE_2_6_FIXES.md` for fix details.
**Updated Verdict:** PASS

---

## 1. Commands Run

| Command | Result |
|---------|--------|
| `NODE_OPTIONS="--max-old-space-size=4096" pnpm run build` | **PASS** — Client + server bundles built successfully in ~31s |
| `npx tsc --noEmit` | **PASS** — Zero TypeScript errors |
| `pnpm run dev` | **PASS** — Dev server started on port 5174 (5173 was occupied) |
| Browser tests via agent-browser | **PASS** — Multiple viewports tested, screenshots captured |

---

## 2. Changed Files Reviewed

| File | Status | Notes |
|------|--------|-------|
| `app/components/mobile/MobileShell.tsx` | Reviewed | Main mobile shell component. Contains mount effect and sync effect. Two bugs found (see §5). |
| `app/components/mobile/MobileBottomTabs.tsx` | Reviewed | Bottom tab bar. Settings tab calls wrong store. Bug found (see §5). |
| `app/lib/stores/mobile.ts` | Reviewed | Simple Nanostore atom. Clean, no issues. |
| `app/styles/mobile.scss` | Reviewed | CSS overrides for <640px. Fragile selectors but functional. Minor concerns (see §5). |
| `app/components/chat/BaseChat.tsx` | Reviewed | MobileShell added inside `<ClientOnly>` after `{baseChat}`. Correct insertion point. |
| `app/styles/index.scss` | Reviewed | `@use 'mobile.scss'` added. Correct. |
| `docs/STAGE_2_MOBILE_SHELL.md` | Reviewed | Comprehensive documentation. Accurate except for unchecked manual-test items. |

---

## 3. SSR/Hydration Findings

| Check | Result | Evidence |
|-------|--------|----------|
| `window.innerWidth` in React render | **SAFE** | No direct window access in any mobile component's render path. The only `window.innerWidth` usage is inside `useEffect` in `MobileShell.tsx` (line 58), which runs client-only after mount. |
| Unstable server/client markup | **SAFE** | `MobileShell` is wrapped in `<ClientOnly>` in `BaseChat.tsx` (line 508). SSR renders nothing for mobile shell; client hydration adds it. |
| Client-only APIs outside ClientOnly/effects | **SAFE** | `useSettingsStore.getState()` in `MobileBottomTabs` is called inside a `useCallback` (event handler), not during render. |
| `isMobile()` utility in render | **SAFE (not our code)** | `app/utils/mobile.ts` uses `globalThis.innerWidth` which would fail on SSR. However, it is NOT used by any mobile shell component. It IS used in `EditorPanel.tsx` (line 172) but that's inside `Workbench` which is already wrapped in `<ClientOnly>`. Not a regression from Stage 2. |
| `useViewport` hook in render | **SAFE (not our code)** | `app/lib/hooks/useViewport.ts` uses `window.innerWidth` in `useState` initializer. Used by `Workbench.client.tsx` which is inside `<ClientOnly>`. Not a regression from Stage 2. |
| `mobileActiveTab` atom initial value | **SAFE** | Hard-coded to `'chat'`. No server/client divergence. |

**SSR/Hydration Verdict: PASS** — No new hydration risks introduced by Stage 2.

---

## 4. Store Logic Findings

### 4.1 Tab State Transitions

| Tab Clicked | chatStore.showChat | workbenchStore.showWorkbench | workbenchStore.currentView | mobileActiveTab | Terminal |
|-------------|-------------------|------------------------------|---------------------------|-----------------|----------|
| Chat | `true` | `false` | (unchanged) | `'chat'` | (unchanged) |
| Preview | `false` | `true` | `'preview'` | `'preview'` | (unchanged) |
| Files | `false` | `true` | `'code'` | `'files'` | (unchanged) |
| Actions | `false` | `true` | `'code'` | `'actions'` | `toggleTerminal(true)` |
| Settings | (unchanged) | (unchanged) | (unchanged) | `'settings'` | (unchanged) |

### 4.2 Sync Effect Analysis (MobileShell.tsx lines 42-48)

```tsx
useEffect(() => {
  if (showWorkbench && activeTab === 'chat') {
    mobileActiveTab.set('preview');
  } else if (!showWorkbench && activeTab !== 'chat' && activeTab !== 'settings') {
    mobileActiveTab.set('chat');
  }
}, [showWorkbench, activeTab]);
```

**Scenario A: AI starts streaming, workbench opens automatically**
- `showWorkbench` → `true`, `activeTab` is `'chat'`
- First branch fires: `mobileActiveTab.set('preview')`
- **Result:** Tab bar correctly switches to Preview. **CORRECT**

**Scenario B: User clicks workbench X button**
- `showWorkbench` → `false`, `activeTab` is `'preview'` (or `'files'` or `'actions'`)
- Second branch fires: `mobileActiveTab.set('chat')`
- **BUG:** `chatStore.showChat` is NOT set back to `true`. Since Preview/Files tabs set it to `false`, and the sync effect only updates `mobileActiveTab`, the chat panel remains hidden (CSS `opacity: 0; transform: translateX(-50%)`).
- **Result:** Blank screen on mobile — no workbench, no visible chat. **BROKEN**

**Scenario C: User on 'actions' tab, workbench closes**
- Same as Scenario B — `chatStore.showChat` stays `false`.

**Scenario D: User on 'settings' tab, workbench closes**
- `activeTab === 'settings'` — second branch skipped (correct, settings doesn't change chat/workbench).

### 4.3 Desktop State Contamination

**Scenario: Mobile user clicks Preview tab, then resizes to desktop**
1. Preview tab click: `chatStore.setKey('showChat', false)`
2. `BaseChat` renders with `data-chat-visible="false"`
3. CSS rule `&[data-chat-visible='false'] .Chat` applies: `transform: translateX(-50%); opacity: 0`
4. User resizes to desktop (≥640px)
5. No resize listener resets `showChat` — it stays `false`
6. Desktop chat panel is hidden, workbench may be empty (no project active)
7. **Result:** Blank white screen on desktop. **BROKEN**

**Recovery:** User can click the sidebar toggle in the workbench header (if workbench is visible) or the Chat tab on mobile to restore `showChat = true`.

### 4.4 Store Logic Verdict: FAIL — Two bugs found

---

## 5. Mobile CSS Findings

### 5.1 Breakpoint Verification

| CSS Mechanism | Breakpoint | UnoCSS Class | Consistent? |
|---------------|-----------|--------------|-------------|
| MobileBottomTabs show/hide | <640px visible, ≥640px hidden | `sm:hidden` | Yes — `sm:` = `@media (min-width: 640px)`, so `sm:hidden` = hide at ≥640px |
| mobile.scss overrides | `@media (max-width: 639px)` | N/A | Yes — `max-width: 639px` is the inverse of `min-width: 640px` |
| Actions overlay | `sm:hidden` | Yes | Consistent with tab bar |

### 5.2 Desktop Regression Check

| CSS Rule | Desktop Impact | Safe? |
|----------|---------------|-------|
| `.Chat { --chat-min-width: 0px !important; min-width: 0 !important }` | Only applies at <640px | **SAFE** |
| `.z-workbench > div > div { bottom: calc(56px + ...) !important }` | Only applies at <640px | **SAFE** |
| `.z-sidebar { display: none !important }` | Only applies at <640px | **SAFE** |
| `[class*="i-ph:sidebar-simple"] { display: none !important }` | Only applies at <640px | **SAFE** |
| `:root { --header-height: 48px }` | Only applies at <640px | **SAFE** |

### 5.3 Safe-Area Inset

| Element | Uses `env(safe-area-inset-bottom)`? | Correct? |
|---------|-------------------------------------|----------|
| MobileBottomTabs (tab bar) | Yes — `paddingBottom: env(safe-area-inset-bottom, 0px)` | **YES** |
| MobileShell spacer | Yes — `marginBottom: env(safe-area-inset-bottom, 0px)` | **YES** |
| Workbench bottom offset | Yes — `calc(56px + env(safe-area-inset-bottom, 0px))` | **YES** |
| ChatBox input area | No explicit safe-area padding | **CONCERN** — relies on the spacer div which is outside BaseChat's scrollable area |

### 5.4 Keyboard Overlap Risk

When the virtual keyboard opens on mobile (e.g., when tapping the chat input textarea):
- The browser may use `visualViewport` resizing, which shrinks the layout viewport
- The `fixed` bottom tab bar could move up with the viewport or stay at the bottom of the visual viewport
- **iOS Safari:** `position: fixed` elements typically stay relative to the layout viewport, so the tab bar may be pushed up by the keyboard. This could overlap with the chat input.
- **Android Chrome:** Behavior varies by IME mode (resize vs pan). The tab bar is typically pushed up.
- **Mitigation:** The tab bar's `position: fixed; bottom: 0` should be handled by the browser's default keyboard avoidance. However, this was NOT tested in this verification pass (requires a real device or touch-enabled emulation).
- **Recommendation:** Test on real devices in Stage 3.

### 5.5 Z-Index Conflict Analysis

| Component | Z-Index | Layer |
|-----------|---------|-------|
| `.z-workbench` | 3 | Workbench panel |
| `.z-prompt` | 2 | Chat prompt area |
| Actions overlay | 40 (z-40) | Quick actions panel |
| MobileBottomTabs | 50 (z-50) | Bottom tab bar |
| `.z-sidebar` | 997 | Sidebar (hidden on mobile) |
| `.z-logo` | 998 | Logo |
| `.z-max` | 999 | Maximum z-layer |
| `.z-toast` | 1000 | Toast notifications |
| Resize handle | 999 | Panel resize handles |
| ControlPanel (Radix Dialog) | Portal, high z-index | Settings dialog |

**Conflicts found:** None. The tab bar at z-50 is above the workbench (z-3) and below toasts (z-1000). Settings dialog (Radix portal) would render above the tab bar. No overlap issues.

### 5.6 Fragile CSS Selectors

| Selector | Fragility | Risk |
|----------|-----------|------|
| `.z-workbench > div > div` | **HIGH** | Relies on Workbench component's internal DOM structure. If Workbench.client.tsx changes its wrapping divs, this selector breaks silently. |
| `[class*="i-ph:sidebar-simple"]` | **MEDIUM** | Relies on UnoCSS icon class naming convention. If icon names change or UnoCSS is updated, this breaks silently. |
| `!important` on all overrides | **LOW** | Necessary to override inline styles and higher-specificity selectors. Not ideal but functional. |

### 5.7 CSS Verdict: PASS — No desktop regression, but fragile selectors noted for future refactoring.

---

## 6. Mobile Viewport Test Results

| Viewport | App Loads | Console Errors | Tab Bar Visible | Chat Input Visible | Chat Input Behind Tab Bar | Desktop Layout |
|----------|-----------|----------------|-----------------|-------------------|--------------------------|----------------|
| iPhone SE (375×667) | YES | No JS errors | YES (5 tabs) | YES | NO (51px gap) | N/A |
| iPhone 14 (390×844) | YES | No JS errors | YES (5 tabs) | YES | NO (198px gap) | N/A |
| Large phone (430×932) | YES | No JS errors | YES (5 tabs) | YES | NO (272px gap) | N/A |
| Tablet (768×1024) | YES | No JS errors | NO (hidden) | YES | N/A | Preserved |
| Desktop (1280×800) | YES | No JS errors | NO (hidden) | YES | N/A | Preserved |

**Chat Input Position Verification:**

| Viewport | Chat Input Bottom (y) | Tab Bar Top (y) | Gap |
|----------|----------------------|-----------------|-----|
| 375×667 | 566px | 617px | 51px |
| 390×844 | 596px | 794px | 198px |
| 430×932 | 610px | 882px | 272px |

The chat input is **NOT** hidden behind the tab bar on any tested mobile viewport. The spacer div provides adequate clearance.

---

## 7. Tab Switching Test Results (375×667)

| Tab | Visual Result | Issues |
|-----|--------------|--------|
| Chat | Landing page with hero text and chat input. Tab highlighted. | **NONE** |
| Preview | Tab highlights correctly. **No visible change** — the workbench has no project to display, so the landing page content persists with chat hidden (`opacity: 0`). | **CONFUSING UX** — User sees the same screen but the Chat tab is no longer highlighted. |
| Files | Same as Preview — tab highlights, no visible content change on landing page. | **CONFUSING UX** — Same issue. |
| Actions | Quick Actions overlay appears above tab bar with 4 buttons (2 enabled, 2 disabled). | **NONE** — This tab works correctly. |
| Settings | Tab highlights. **No dialog opens.** | **BUG** — `useSettingsStore.openSettings()` is called but nothing renders based on this Zustand state (see §8.2). |

**Note:** The Preview/Files "no visible change" issue is specific to the landing page (no active project). Once a project is running, these tabs would show the preview and file tree respectively. This is a known limitation, not a bug.

---

## 8. Desktop After Mobile Test

**Procedure:**
1. Set viewport to 375×667 (mobile)
2. Click **Preview** tab
3. Resize to 1280×800 (desktop)

**Result:** `data-chat-visible="false"` persists on desktop. The chat panel is visually hidden (`opacity: 0; transform: translateX(-50%)`). With no active project, the workbench is also empty, resulting in a **blank white screen**.

**Root Cause:** `MobileBottomTabs.handleTabChange` modifies shared stores (`chatStore`, `workbenchStore`) that also drive the desktop layout. No resize listener resets these stores when the viewport crosses the 640px threshold.

**Recovery:** Clicking the Chat tab on mobile (before or after resizing) restores `showChat=true`. On desktop, clicking the sidebar toggle in the workbench header also restores chat visibility.

---

## 9. Console Errors and Warnings

| Type | Message | Source | Stage 2 Related? |
|------|---------|--------|-------------------|
| error | `Failed to fetch Supabase stats` | Supabase service (no Supabase configured) | **NO** |
| warn | `[unocss] failed to load icon "ph:git-repository"` | UnoCSS icon loader | **NO** |
| warn | `Data fetching is changing to a single fetch in React Router v7` | Remix framework | **NO** |
| warn | `The CJS build of Vite's Node API is deprecated` | Vite | **NO** |

**No uncaught JavaScript exceptions.** No React hydration errors. No errors related to the mobile shell.

---

## 10. Real Project Flow Test

Could NOT be tested — no API key is configured. The app requires a valid API key for an LLM provider to generate project code. UI-only behavior was tested instead (see §7 and §8).

**What would need to be tested with an API key:**
- Send a prompt → AI generates code → Preview tab shows live preview
- Switch between Chat ↔ Preview ↔ Files during an active project
- Click "Export ZIP" from Actions tab during an active project
- Click "Toggle Terminal" from Actions tab during an active project
- Click workbench X button on mobile and verify return to Chat tab
- Verify WebContainer (SharedArrayBuffer) works on mobile browsers

---

## 11. Issues Found

### BUG-1: Desktop State Contamination (CRITICAL)

**Severity:** CRITICAL
**Reproducibility:** 100%
**Impact:** Blank screen on desktop after mobile tab interaction

**Steps to reproduce:**
1. Open app on mobile viewport (<640px)
2. Click Preview or Files tab
3. Resize browser to desktop (≥640px)
4. Chat panel is hidden, workbench may be empty → blank screen

**Root cause:** Mobile tab clicks set `chatStore.showChat = false` globally. No resize listener resets this when crossing the 640px breakpoint.

**Proposed fix:** Add a resize listener in `MobileShell.tsx` that resets mobile-affected store state when the viewport crosses 640px:

```tsx
useEffect(() => {
  const mq = window.matchMedia('(min-width: 640px)');
  const handler = (e: MediaQueryListEvent) => {
    if (e.matches) {
      // Crossing from mobile to desktop: restore desktop defaults
      chatStore.setKey('showChat', true);
      mobileActiveTab.set('chat');
    }
  };
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}, []);
```

This uses `matchMedia` (SSR-safe inside `useEffect`) and only fires on actual breakpoint crossing.

### BUG-2: Workbench X Button Doesn't Restore Chat (HIGH)

**Severity:** HIGH
**Reproducibility:** 100% (when workbench is active on mobile)
**Impact:** Blank screen on mobile after closing workbench

**Steps to reproduce:**
1. Have an active project (workbench visible on mobile)
2. Click the workbench X (close) button
3. MobileShell sync effect sets `mobileActiveTab = 'chat'`
4. But `chatStore.showChat` stays `false` → chat panel hidden

**Root cause:** The `MobileShell` sync effect (lines 42-48) updates `mobileActiveTab` but doesn't restore `chatStore.showChat = true`.

**Proposed fix:** Add `chatStore.setKey('showChat', true)` to the sync effect's second branch:

```tsx
else if (!showWorkbench && activeTab !== 'chat' && activeTab !== 'settings') {
  mobileActiveTab.set('chat');
  chatStore.setKey('showChat', true);  // ← ADD THIS
}
```

### BUG-3: Settings Tab Is Non-Functional (MEDIUM)

**Severity:** MEDIUM
**Reproducibility:** 100%
**Impact:** Settings tab click does nothing visible

**Root cause:** `MobileBottomTabs` calls `useSettingsStore.getState().openSettings()` which sets `isOpen: true` in the Zustand store. However, the `ControlPanel` component is only rendered inside `Menu.client.tsx` using a local `useState` variable (`isSettingsOpen`). No component reads `useSettingsStore.isOpen` to render the settings dialog. Additionally, the sidebar (`Menu.client.tsx`) is hidden on mobile via CSS `display: none !important`, so even if the local state were set, the dialog wouldn't be visible.

**Proposed fix:** Two options:

**Option A (Minimal, recommended for Stage 2.5):** Render a `ControlPanel` directly in `MobileShell` that listens to `useSettingsStore.isOpen`:

```tsx
// In MobileShell.tsx
const settingsOpen = useSettingsStore((s) => s.isOpen);

// In the render:
{settingsOpen && (
  <ControlPanel
    open={settingsOpen}
    onClose={() => useSettingsStore.getState().closeSettings()}
  />
)}
```

**Option B (Better, but more changes):** Refactor `Menu.client.tsx` to use `useSettingsStore` instead of local state, so both the sidebar button and mobile tab trigger the same state.

### ISSUE-4: Fragile CSS Selectors (LOW)

**Severity:** LOW
**Impact:** Silent breakage if Workbench component structure changes

The `.z-workbench > div > div` selector relies on the exact DOM structure of `Workbench.client.tsx`. If the component adds or removes a wrapping div, the mobile bottom padding for the workbench will stop working without any error.

**Recommendation:** Add a `data-mobile-workbench-inner` attribute to the target div in `Workbench.client.tsx` in a future stage, and target that attribute instead of the structural selector.

### ISSUE-5: Preview/Files Tabs Show No Visual Change on Landing Page (LOW)

**Severity:** LOW (by design)
**Impact:** Confusing UX for first-time users

When no project is active, clicking Preview or Files tab hides the chat (`showChat=false`) and shows the workbench, but the workbench only renders when `chatStarted === true`. The result is the landing page content with the chat hidden, which looks the same as before except the tab highlight changed.

**Recommendation:** In a future stage, add a placeholder message like "Start a conversation to see the preview" or automatically keep the Chat tab active when there's no project.

---

## 12. Recommended Fixes Before Stage 3

### Must Fix (Critical/High)

| Bug | Fix | Risk | Effort |
|-----|-----|------|--------|
| BUG-1: Desktop state contamination | Add `matchMedia` resize listener in `MobileShell.tsx` | Low — additive, client-only | ~10 lines |
| BUG-2: Workbench X doesn't restore chat | Add `chatStore.setKey('showChat', true)` to sync effect | Very low — single line addition | 1 line |

### Should Fix (Medium)

| Bug | Fix | Risk | Effort |
|-----|-----|------|--------|
| BUG-3: Settings tab non-functional | Render `ControlPanel` in `MobileShell` listening to `useSettingsStore.isOpen` | Low — reuses existing component | ~15 lines |

### Can Defer (Low)

| Issue | Fix | Risk | Effort |
|-------|-----|------|--------|
| ISSUE-4: Fragile CSS selectors | Add `data-` attribute to Workbench inner div | Low — requires touching Workbench.client.tsx | ~5 lines |
| ISSUE-5: Empty workbench on landing page | Add placeholder message | Low — UI only | ~10 lines |

---

## 13. Minimal Patch Plan

### Patch 1: Fix BUG-1 and BUG-2 in MobileShell.tsx

**File:** `app/components/mobile/MobileShell.tsx`

**Change 1:** Add resize listener after the existing mount effect:
```tsx
// After the existing useEffect([], []) block, add:
useEffect(() => {
  const mq = window.matchMedia('(min-width: 640px)');
  const handler = (e: MediaQueryListEvent) => {
    if (e.matches) {
      // Crossing from mobile to desktop: restore desktop defaults
      chatStore.setKey('showChat', true);
      mobileActiveTab.set('chat');
    }
  };
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}, []);
```

**Change 2:** Fix the sync effect to restore `showChat`:
```tsx
// Line 45-47, change:
else if (!showWorkbench && activeTab !== 'chat' && activeTab !== 'settings') {
  mobileActiveTab.set('chat');
  chatStore.setKey('showChat', true);  // ← ADD THIS LINE
}
```

### Patch 2: Fix BUG-3 in MobileShell.tsx

**File:** `app/components/mobile/MobileShell.tsx`

**Add import:**
```tsx
import { ControlPanel } from '~/components/@settings/core/ControlPanel';
import { useSettingsStore } from '~/lib/stores/settings';
```

**Add store subscription:**
```tsx
const settingsOpen = useSettingsStore((s) => s.isOpen);
```

**Add render (inside the fragment, after Actions overlay):**
```tsx
{settingsOpen && (
  <div className="sm:hidden">
    <ControlPanel
      open={settingsOpen}
      onClose={() => useSettingsStore.getState().closeSettings()}
    />
  </div>
)}
```

Note: The `sm:hidden` wrapper ensures this only renders on mobile (where the sidebar's ControlPanel is hidden). On desktop, the sidebar's ControlPanel handles settings.

---

## 14. Verification Summary

| Category | Verdict | Details |
|----------|---------|---------|
| Build | **PASS** | Clean build, no errors |
| TypeScript | **PASS** | Zero type errors |
| SSR/Hydration | **PASS** | No new hydration risks |
| Store Logic | **FAIL** | 2 bugs (BUG-1 critical, BUG-2 high) |
| Mobile CSS | **PASS** | No desktop regression, safe-area handled, z-index correct |
| Viewport Tests | **PASS** | All 5 viewports render correctly |
| Tab Switching | **PARTIAL** | Chat/Actions work; Preview/Files confusing on landing; Settings broken |
| Desktop After Mobile | **FAIL** | Chat hidden after mobile→desktop resize |
| Console Errors | **PASS** | No Stage-2-related errors |

---

## 15. Final Verdict

## **PASS WITH FIXES**

**Rationale:**
- The mobile shell prototype fundamentally works: bottom tabs render, tab switching updates stores, CSS show/hide is correct, no SSR issues, no desktop CSS regression.
- Two bugs must be fixed before Stage 3:
  1. **BUG-1 (Critical):** Desktop state contamination when resizing from mobile to desktop
  2. **BUG-2 (High):** Workbench X button doesn't restore chat visibility on mobile
- One bug should be fixed before Stage 3:
  3. **BUG-3 (Medium):** Settings tab is non-functional on mobile
- All three fixes are small, localized, and low-risk (additive code, no refactoring).
- After applying patches 1 and 2 (and optionally patch 3), the verdict would be **PASS**.

**Are we allowed to proceed to Stage 3?** **Yes, after applying patches 1 and 2.** Patch 3 is strongly recommended but not blocking.

---

## 16. Items Not Tested (Require Real Device or API Key)

- [ ] Virtual keyboard overlap on iOS Safari and Android Chrome
- [ ] Safe-area-inset-bottom on iPhone with home indicator (real device)
- [ ] WebContainer/SharedArrayBuffer support on mobile browsers
- [ ] Real project flow (prompt → AI → preview → files → export)
- [ ] Touch gestures vs click events
- [ ] Performance on low-end mobile devices
- [ ] `env(safe-area-inset-bottom)` behavior on standalone PWA mode
