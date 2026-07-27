# Mobile-First Direction — palmkit.app Fork

## Goal

Transform the current desktop-oriented palmkit.app UI into a mobile-first AI coding workspace while preserving full desktop functionality. The mobile experience should not be a scaled-down desktop site but rather a purpose-built workflow for coding on a phone.

---

## Current UI Architecture (Desktop)

The current palmkit.app layout is a classic two-panel IDE:

```
┌──────────────────────────────────────────────────────────────────┐
│  Header (logo, settings button, chat history toggle)             │
├────────────────────────────┬─────────────────────────────────────┤
│                            │                                     │
│   Chat Panel               │   Workbench Panel                  │
│   ┌──────────────────┐     │   ┌─ Code | Diff | Preview ──────┐ │
│   │ Messages         │     │   │                              │ │
│   │                  │     │   │   File Tree  |  Editor       │ │
│   │                  │     │   │              |               │ │
│   │                  │     │   │              |  Terminal     │ │
│   │ ┌──────────────┐ │     │   │              |               │ │
│   │ │ Chat Input   │ │     │   │   Preview (iframe)          │ │
│   │ │ + Model/Prov │ │     │   │                              │ │
│   │ └──────────────┘ │     │   └──────────────────────────────┘ │
│                            │                                     │
├────────────────────────────┴─────────────────────────────────────┤
│  (Sidebar: Chat history — togglable from left)                   │
└──────────────────────────────────────────────────────────────────┘
```

Key characteristics:
- `react-resizable-panels` splits the screen into chat (left) and workbench (right)
- Workbench uses a `Slider` component (code/diff/preview tabs)
- Settings is a full-screen dialog overlay
- Sidebar slides in from the left
- No mobile breakpoint handling beyond the existing `isMobile()` check (640px)
- The `BaseChat` component renders both panels side-by-side

---

## Proposed Mobile Navigation

Replace the side-by-side panel with a tabbed mobile shell. The user sees one context at a time:

```
┌──────────────────────┐
│  ◉ Chat  ○ Preview  │  ← Tab bar (bottom or top)
│  ○ Files ○ Actions  │
│  ○ Settings          │
├──────────────────────┤
│                      │
│   [Active Tab        │
│    Content]          │
│                      │
│                      │
│                      │
│                      │
├──────────────────────┤
│  ┌────────────────┐  │
│  │ Chat Input     │  │  ← Always visible on Chat tab
│  │ 🎤 📎 ➤       │  │     Collapsed on other tabs
│  └────────────────┘  │
└──────────────────────┘
```

### Five Tabs

| Tab | Purpose | Maps To |
|-----|---------|---------|
| **Chat** | Message list, input, model selector | `BaseChat` (messages area + `ChatBox`) |
| **Preview** | Live preview iframe, device frame | `Preview.tsx` |
| **Files** | File tree, file editor | `EditorPanel.tsx` + `FileTree.tsx` |
| **Actions** | Running actions, terminal, logs | `Terminal.tsx` + action status |
| **Settings** | API keys, provider, features, integrations | `ControlPanel.tsx` |

### Tab Priority

1. **Chat** is the default tab when a user opens the app
2. **Preview** is the second most important — users want to see their app
3. **Files** for inspecting/editing specific files
4. **Actions** for debugging (terminal output, build errors)
5. **Settings** for initial setup and configuration

---

## How to Transform Without Breaking Desktop

### Strategy: Conditional Rendering, Not Replacement

The safest approach is to detect viewport and render either:
- **Desktop**: Current `BaseChat` layout (side-by-side panels)
- **Mobile**: New `MobileShell` component (tabbed navigation)

```tsx
// In _index.tsx or BaseChat.tsx
const isMobile = useViewport(); // already exists in app/lib/hooks/useViewport.ts

return isMobile ? (
  <MobileShell {...props} />
) : (
  <BaseChat {...props} />
);
```

### Component Reuse

All existing components should be reused inside `MobileShell`:

| Mobile Tab | Reused Component | Wrapping Needed |
|-----------|-----------------|-----------------|
| Chat | `Messages.client.tsx` + `ChatBox.tsx` + `ModelSelector.tsx` | Stack vertically, full-width |
| Preview | `Preview.tsx` | Full-screen iframe, remove device frame toggle complexity |
| Files | `FileTree.tsx` + `CodeMirrorEditor.tsx` | Stacked: tree above, editor below (or drill-down) |
| Actions | `Terminal.tsx` + action status list | Simplified terminal, collapsible action cards |
| Settings | `ControlPanel.tsx` | Full-screen settings instead of dialog |

### CSS Strategy

1. **Do not modify existing SCSS modules** — they work for desktop
2. **Create mobile-specific styles** in a new `app/styles/mobile.scss` or `app/components/mobile/MobileShell.module.scss`
3. **Use UnoCSS responsive utilities** (`sm:`, `md:`, `lg:`) for inline responsive adjustments
4. **The existing breakpoint is 640px (`sm:`)** — `app/utils/mobile.ts` already uses this
5. **Consider adding `xs:` breakpoint** (480px) for small phones

### Safe Touch Points

1. **`app/routes/_index.tsx`** — Wrap `<Chat />` in a viewport-aware container
2. **New: `app/components/mobile/MobileShell.tsx`** — The mobile tabbed shell
3. **New: `app/components/mobile/MobileTabBar.tsx`** — Bottom navigation tabs
4. **New: `app/components/mobile/MobileChat.tsx`** — Full-screen chat for mobile
5. **New: `app/components/mobile/MobilePreview.tsx`** — Full-screen preview for mobile
6. **New: `app/components/mobile/MobileFiles.tsx`** — File browser + editor for mobile
7. **New: `app/components/mobile/MobileActions.tsx`** — Terminal + action status for mobile
8. **New: `app/components/mobile/MobileSettings.tsx`** — Simplified settings for mobile
9. **`app/lib/hooks/useViewport.ts`** — Already exists, may need enhancement

---

## What Should Be Hidden or Simplified on Mobile

### Hide Completely
1. **Keyboard shortcuts** — No keyboard on mobile; remove shortcut hints from UI
2. **Drag-and-drop file reordering** — Not practical on touch
3. **Resizable panels** — No mouse resize; use full-screen tabs instead
4. **Desktop-only toolbar buttons** — e.g., "Open in VS Code", split editor views
5. **DndProvider wrapper** — The HTML5Backend doesn't support touch; skip on mobile
6. **Chat history sidebar** — Replace with a slide-up sheet or dedicated tab
7. **Complex context menu** — Replace with long-press / bottom sheet actions

### Simplify
1. **Model Selector** — Instead of a complex searchable dropdown with provider tabs, use a simple provider → model two-step picker or bottom sheet
2. **API Key Input** — Single screen for entering one key at a time, not a full settings panel
3. **File Tree** — Drill-down navigation instead of expandable tree (more touch-friendly)
4. **Terminal** — Read-only terminal output by default; optional keyboard for input
5. **Code Editor** — Read-only by default; tap-to-edit with a simplified toolbar
6. **Preview** — Full-screen iframe; remove complex device frame controls for mobile
7. **Diff View** — Show diff summary, not full side-by-side diff
8. **Artifact Actions** — Collapsible cards instead of inline expanded view
9. **Header** — Minimal: logo + current project name + menu icon

### Streamline for First-Time Experience
1. **Onboarding** — Replace the full settings page with a guided "Add your API key" flow
2. **Template Selection** — Show 3-4 popular templates instead of the full grid
3. **Provider Selection** — Default to a single recommended provider; hide the rest initially

---

## What Must Remain Available for Power Users

Even on mobile, these features must remain accessible (even if behind an extra tap):

1. **All providers and models** — Don't remove any provider; just organize them better
2. **Full code editor** — Power users will want to edit files directly
3. **Terminal access** — Essential for debugging
4. **Context optimization toggle** — Affects token usage and cost
5. **Chat mode switch** (build vs. discuss) — Changes LLM behavior significantly
6. **File locking** — Prevent accidental overwrites
7. **Chat export/import** — Data portability
8. **Supabase/Vercel/Netlify connections** — Deployment features
9. **Prompt enhancement** — Useful for voice-to-code workflows
10. **Web search in chat** — Context enrichment
11. **Screenshot capture from preview** — For "show AI what's wrong" workflows
12. **Element inspector (Tap-to-Edit)** — Critical for the mobile value proposition

---

## UX Risks on iPhone/Safari

### 1. WebContainer Compatibility
- **Risk**: WebContainer requires SharedArrayBuffer, which needs cross-origin isolation headers (`COOP`/`COEP`). Safari on iOS 15.2+ supports this, but older versions do not.
- **Impact**: WebContainer may simply fail to boot on older iOS devices
- **Mitigation**: Detect WebContainer support on load, show a clear error message with minimum iOS version requirement, consider a "chat-only" mode where WebContainer is not needed

### 2. iframe Sandboxing in Preview
- **Risk**: Safari has stricter iframe sandboxing than Chrome. The preview iframe might not render correctly if sandbox attributes are too restrictive.
- **Impact**: Preview may appear blank or fail to load
- **Mitigation**: Test with minimal sandbox attributes; use `credentialless` COEP mode (already configured in WebContainer boot)

### 3. 100vh Bug on iOS
- **Risk**: Safari's `100vh` includes the address bar, causing content to extend behind it. When the address bar hides on scroll, the viewport height changes.
- **Impact**: Content may overflow or be hidden behind the address bar
- **Mitigation**: Use `dvh` (dynamic viewport height) or `svh` (small viewport height) CSS units; use `100dvh` for full-screen layouts

### 4. Touch Event Handling
- **Risk**: xterm.js terminal may not handle touch events well for text selection and scrolling.
- **Impact**: Terminal interaction may be difficult on mobile
- **Mitigation**: Use xterm.js touch addons if available; consider a "copy output" button instead of text selection

### 5. Virtual Keyboard Overlap
- **Risk**: When the software keyboard opens, it can push content up or overlap with the chat input area.
- **Impact**: Chat input may be hidden behind the keyboard
- **Mitigation**: Use `visualViewport` API to detect keyboard height; use `position: fixed` with dynamic `bottom` offset; test with `keyboard-intrinsic-height` viewport meta option

### 6. Memory Pressure
- **Risk**: WebContainer + code editor + terminal + preview is memory-intensive. iOS Safari has a ~1.5GB memory limit for web content, and tabs may be killed aggressively.
- **Impact**: App may crash or become unresponsive on memory-constrained devices
- **Mitigation**: Lazy-load heavy components; don't boot WebContainer until needed; consider a lighter terminal implementation for mobile

### 7. Service Worker / Cache Issues
- **Risk**: Safari's service worker caching behavior differs from Chrome. May cause stale assets or offline issues.
- **Impact**: Users may see outdated versions of the app
- **Mitigation**: Use explicit cache-busting; test PWA behavior on Safari

---

## UX Risks on Android/Chrome

### 1. WebContainer Performance
- **Risk**: WebContainer is CPU-intensive. Lower-end Android devices may struggle.
- **Impact**: Slow boot times, laggy preview, potential crashes
- **Mitigation**: Show loading indicator with estimated boot time; allow user to proceed in chat-only mode while WebContainer boots in background

### 2. Chrome Custom Tabs vs. Full Browser
- **Risk**: If users open the app in a Chrome Custom Tab (from a link), some APIs may not be available.
- **Impact**: WebContainer may not boot in Custom Tabs
- **Mitigation**: Detect if running in Custom Tab, prompt to "Open in Chrome" if needed

### 3. Back Button Behavior
- **Risk**: Android's hardware back button may navigate away from the app instead of going back within the tab navigation.
- **Impact**: Accidental app exit
- **Mitigation**: Use `history.pushState()` for tab navigation; intercept `popstate` event to switch tabs instead of navigating away

### 4. File Upload
- **Risk**: Android file picker may not support all file types or may have different behavior for folder upload.
- **Impact**: Folder import may not work on Android
- **Mitigation**: Test file upload flow; provide alternative import methods (URL import, paste code)

### 5. Screen Size Diversity
- **Risk**: Android devices range from 320px to 600px+ width. The UI must be responsive across this range.
- **Impact**: Layout may break on very small or very large phones
- **Mitigation**: Test on 320px, 360px, 390px, 412px, and 600px widths; use fluid typography and spacing

### 6. Notification Permissions
- **Risk**: Android Chrome supports web push notifications, but permission prompts can be intrusive.
- **Impact**: Users may block notifications if prompted at wrong time
- **Mitigation**: Only request notification permission after user explicitly enables notifications in settings

---

## Mobile-Specific Features to Add

### Phase 1 (MVP Shell)
1. **Bottom tab navigation** — Chat / Preview / Files / Actions / Settings
2. **Full-screen chat** with always-visible input
3. **Full-screen preview** with pull-to-refresh
4. **Simplified file browser** with drill-down navigation
5. **Compact terminal** output view

### Phase 2 (Mobile Polish)
1. **Swipe gestures** — Swipe between tabs (Chat ↔ Preview)
2. **Pull-down to refresh** — Reload preview
3. **Haptic feedback** — On action completion, errors
4. **Share intent** — Share code via mobile share sheet
5. **Add to Home Screen** — PWA manifest with proper icons

### Phase 3 (Advanced Mobile)
1. **Voice input** — Already exists (SpeechRecognition.tsx), enhance for mobile
2. **Camera capture** — Take photo of wireframe, send to AI
3. **Tap-to-Edit** — Select element in preview, ask AI to modify
4. **Offline mode** — Chat history available offline (IndexedDB already persists)
5. **Split view on tablets** — Side-by-side on larger screens

---

## Implementation Approach

### Step 1: Create MobileShell (New Component)
```tsx
// app/components/mobile/MobileShell.tsx
// - Detects mobile viewport
// - Renders tab navigation
// - Manages active tab state
// - Wraps existing components in mobile-friendly layouts
```

### Step 2: Add Viewport Detection
```tsx
// app/lib/hooks/useViewport.ts already exists
// Enhance with:
// - Breakpoint constants
// - Orientation detection
// - Keyboard height detection
```

### Step 3: Conditional Rendering
```tsx
// In BaseChat.tsx or _index.tsx:
// if (isMobile) return <MobileShell {...props} />
// else return <BaseChat {...props} />
```

### Step 4: Mobile Chat
- Full-screen message list
- Fixed bottom input bar
- Model/provider selector as bottom sheet
- Action cards as collapsible items

### Step 5: Mobile Preview
- Full-screen iframe
- Floating URL bar
- Back button to return to chat

### Step 6: Mobile Files
- Drill-down file browser
- Full-screen code editor on file tap
- Back navigation to file list

### Step 7: Mobile Actions
- Terminal output as scrollable log
- Action status cards
- Collapsible terminal input

### Step 8: Mobile Settings
- Full-screen settings with section navigation
- Simplified API key entry
- Provider selection as guided flow
