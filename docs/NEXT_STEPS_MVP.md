# Next Steps MVP — Staged Plan

## Guiding Principle

Each stage is independently testable and deployable. No stage breaks the previous stage. We commit to running the full app at every stage boundary to verify nothing is broken.

---

## Stage 1: Run Unmodified palmkit.app

**Goal:** Verify the upstream project runs locally without any modifications.

**Tasks:**
1. Clone the repository ✅
2. Install dependencies (`pnpm install`) ✅
3. Create `.env.local` from `.env.example` ✅
4. Run `pnpm run dev` and verify the app loads ✅
5. Build for production (`NODE_OPTIONS="--max-old-space-size=4096" pnpm run build`) ✅
6. Document any issues encountered ✅

**Verification:**
- [x] Dev server starts on `http://localhost:5173/`
- [x] Landing page renders with chat input
- [x] Settings panel opens
- [x] Model selector shows providers
- [x] API key input works
- [x] Production build succeeds (with increased memory)

**Issues Found:**
- Production build requires `NODE_OPTIONS="--max-old-space-size=4096"` to avoid OOM
- Some empty chunks generated during build (API routes without client-side code) — benign
- No `.env.local` was pre-created; must be created from `.env.example`

**Duration:** Complete

---

## Stage 2: Add Mobile Shell Only

**Goal:** Add a mobile-conditional UI shell that provides tabbed navigation on small screens, without changing any existing desktop functionality.

**Principle:** Desktop users see zero changes. Mobile users get a new navigation paradigm.

**Tasks:**
1. Create `app/components/mobile/MobileShell.tsx`
   - Bottom tab bar with: Chat / Preview / Files / Actions / Settings
   - Active tab state management (use Nanostore atom)
   - Full-screen content area for each tab

2. Create `app/components/mobile/MobileTabBar.tsx`
   - Five tab icons with labels
   - Active state indicator
   - Touch-friendly sizing (minimum 44x44px touch targets)

3. Create `app/components/mobile/MobileChat.tsx`
   - Wrap existing `Messages.client.tsx` + `ChatBox.tsx`
   - Full-height message list
   - Fixed-bottom input area
   - Model/provider selector as bottom sheet

4. Create `app/components/mobile/MobilePreview.tsx`
   - Wrap existing `Preview.tsx`
   - Full-screen iframe
   - Floating URL bar at top

5. Create `app/components/mobile/MobileFiles.tsx`
   - Wrap existing `FileTree.tsx` + `CodeMirrorEditor.tsx`
   - Drill-down navigation (tap file → full-screen editor)

6. Create `app/components/mobile/MobileActions.tsx`
   - Wrap existing `Terminal.tsx`
   - Simplified action status cards
   - Read-only terminal output by default

7. Create `app/components/mobile/MobileSettings.tsx`
   - Wrap existing `ControlPanel.tsx` content
   - Full-screen settings instead of dialog

8. Enhance `app/lib/hooks/useViewport.ts`
   - Export breakpoint constants
   - Add `useIsMobile()` convenience hook
   - Consider orientation detection

9. Modify `app/components/chat/BaseChat.tsx`
   - Import `MobileShell`
   - Conditionally render `MobileShell` or existing layout based on viewport
   - **Do not modify existing rendering logic** — only add the conditional

10. Add `app/styles/mobile.scss`
    - Mobile-specific overrides
    - `dvh` units for full-height
    - Touch-friendly spacing

**Files to Create:**
- `app/components/mobile/MobileShell.tsx`
- `app/components/mobile/MobileTabBar.tsx`
- `app/components/mobile/MobileChat.tsx`
- `app/components/mobile/MobilePreview.tsx`
- `app/components/mobile/MobileFiles.tsx`
- `app/components/mobile/MobileActions.tsx`
- `app/components/mobile/MobileSettings.tsx`
- `app/styles/mobile.scss`

**Files to Modify (minimal):**
- `app/components/chat/BaseChat.tsx` — Add conditional: `if (isMobile) return <MobileShell />`
- `app/lib/hooks/useViewport.ts` — Enhance with breakpoint constants

**Verification:**
- [ ] Desktop layout unchanged at widths > 640px
- [ ] Mobile layout shows tabbed navigation at widths <= 640px
- [ ] All five tabs render their content correctly
- [ ] Chat works on mobile (send message, receive response)
- [ ] Preview loads on mobile
- [ ] File tree browsable on mobile
- [ ] Terminal output visible on mobile
- [ ] Settings accessible on mobile
- [ ] No console errors on either viewport

**Rollback:** Remove the conditional in `BaseChat.tsx` and delete the `mobile/` directory.

**Duration:** 1-2 weeks

---

## Stage 3: Add BYOK Onboarding Simplification

**Goal:** Create a streamlined first-run experience that guides the user through adding their first API key and selecting a provider, optimized for mobile.

**Principle:** The current onboarding is "open settings, find API keys, enter key, close settings, select model, start chatting." We want to make this "open app → enter key → start chatting."

**Tasks:**
1. Create `app/components/onboarding/OnboardingFlow.tsx`
   - Step 1: Welcome screen with brief explanation
   - Step 2: "Choose your AI provider" (simplified grid of popular providers)
   - Step 3: "Enter your API key" (single input with validation)
   - Step 4: "Select a model" (filtered to chosen provider's models)
   - Step 5: "Start building!" (redirect to chat)

2. Create `app/components/onboarding/ProviderCard.tsx`
   - Visual card for each provider with icon and name
   - "Get API key" link

3. Create `app/components/onboarding/ApiKeyStep.tsx`
   - Single API key input with test button
   - Validation indicator (green check / red X)
   - Security notice about key storage

4. Add onboarding state to `app/lib/stores/settings.ts`
   - `hasCompletedOnboarding` atom (persisted in localStorage)
   - `onboardingStep` atom

5. Add "Test API Key" endpoint `app/routes/api.test-api-key.ts`
   - Accepts provider name and API key
   - Makes a minimal API call to verify the key works
   - Returns `{ valid: boolean, error?: string }`

6. Modify `app/routes/_index.tsx`
   - Check `hasCompletedOnboarding` before showing Chat
   - Show OnboardingFlow if not completed

7. Add "Change API Key" option in mobile Settings tab

**Files to Create:**
- `app/components/onboarding/OnboardingFlow.tsx`
- `app/components/onboarding/ProviderCard.tsx`
- `app/components/onboarding/ApiKeyStep.tsx`
- `app/routes/api.test-api-key.ts`

**Files to Modify:**
- `app/lib/stores/settings.ts` — Add onboarding state atoms
- `app/routes/_index.tsx` — Conditional onboarding render
- `app/components/mobile/MobileSettings.tsx` — Add "Change API Key" entry point

**Verification:**
- [ ] First-time users see onboarding flow
- [ ] API key test button works
- [ ] After completing onboarding, user lands in chat with selected model
- [ ] Returning users skip onboarding
- [ ] Desktop experience unchanged (onboarding is optional on desktop)
- [ ] API key is saved and persists across sessions

**Rollback:** Set `hasCompletedOnboarding` to always return `true`. Remove onboarding route.

**Duration:** 1 week

---

## Stage 4: Add Project Rules/Skills Files

**Goal:** Allow users to add project-specific instruction files (like `.cursorrules` or `.bolt-rules`) that are included in the system prompt for every chat message.

**Principle:** Power users want to customize AI behavior per project. This is a low-risk feature that enhances the BYOK experience.

**Tasks:**
1. Define the rules file format
   - `.bolt/rules.md` — Project-level rules (always included)
   - `.bolt/skills/` — Directory for skill-specific instructions
   - Example skills: `ui-polish.md`, `bug-fix.md`, `seo.md`, `supabase-setup.md`, `vercel-deploy.md`

2. Create `app/lib/common/project-rules.ts`
   - Read rules files from WebContainer filesystem
   - Parse and validate rules content
   - Inject rules into system prompt

3. Modify `app/lib/.server/llm/stream-text.ts`
   - Add project rules section to system prompt
   - Position after the core system prompt, before context buffer

4. Create `app/components/mobile/MobileSkills.tsx`
   - List available skills
   - Toggle skills on/off per project
   - Show skill description on tap

5. Add skill state to `app/lib/stores/workbench.ts`
   - `activeSkills` atom (persisted per project)

6. Create starter skill files:
   - `.bolt/skills/ui-polish.md` — Instructions for UI improvement
   - `.bolt/skills/bug-fix.md` — Instructions for systematic bug fixing
   - `.bolt/skills/seo.md` — SEO optimization instructions
   - `.bolt/skills/supabase-setup.md` — Supabase integration guide
   - `.bolt/skills/vercel-deploy.md` — Vercel deployment guide
   - `.bolt/skills/github-export.md` — GitHub repository export guide

**Files to Create:**
- `app/lib/common/project-rules.ts`
- `app/components/mobile/MobileSkills.tsx`
- Starter skill markdown files in project templates

**Files to Modify:**
- `app/lib/.server/llm/stream-text.ts` — Add project rules to system prompt
- `app/lib/stores/workbench.ts` — Add active skills state
- `app/utils/constants.ts` — Add skill-related constants

**Verification:**
- [ ] Rules file is read from WebContainer and included in prompt
- [ ] Skills can be toggled on/off
- [ ] LLM behavior changes based on active skills
- [ ] No impact on projects without rules files
- [ ] Desktop experience unchanged

**Rollback:** Remove rules injection from `stream-text.ts`. Skills UI becomes cosmetic only.

**Duration:** 1 week

---

## Stage 5: Add Tap-to-Edit Prototype

**Goal:** Enable users to tap on a UI element in the preview and ask the AI to modify it.

**Principle:** This is the flagship mobile feature. The foundation already exists in `Inspector.tsx` and `ScreenshotStateManager.tsx`.

**Tasks:**
1. Audit existing Inspector functionality
   - `app/components/workbench/Inspector.tsx` — Element inspector
   - `app/components/workbench/InspectorPanel.tsx` — Inspector panel
   - `app/public/inspector-script.js` — Script injected into preview iframe
   - `app/components/chat/ScreenshotStateManager.tsx` — Screenshot capture

2. Create `app/components/mobile/MobileInspector.tsx`
   - Touch-friendly element selection overlay
   - Highlight tapped element with blue outline
   - Show element info (tag, classes, text) in bottom sheet
   - "Ask AI to modify" button that pre-fills chat with element context

3. Enhance the inspector script for mobile
   - Touch event handlers (in addition to click)
   - Element boundary detection with touch precision
   - Visual feedback on tap (brief highlight animation)

4. Create `app/components/mobile/ElementActionSheet.tsx`
   - Bottom sheet with common actions:
     - "Modify this element" → sends to chat with element context
     - "Change color" → sends color-specific prompt
     - "Change text" → sends text-specific prompt
     - "Remove" → sends removal prompt
     - "Inspect code" → opens file at relevant line (if determinable)

5. Modify `app/components/chat/Chat.client.tsx`
   - Handle `selectedElement` state on mobile
   - Include element context in message when sent from inspector
   - Already partially implemented — `selectedElement` is used in `sendMessage()`

6. Test with real projects
   - Create a simple HTML project
   - Test element selection on various element types
   - Verify AI can understand element context and make changes

**Files to Create:**
- `app/components/mobile/MobileInspector.tsx`
- `app/components/mobile/ElementActionSheet.tsx`

**Files to Modify:**
- `app/public/inspector-script.js` — Add touch event support
- `app/components/mobile/MobilePreview.tsx` — Add inspector toggle
- `app/components/chat/Chat.client.tsx` — Enhance selectedElement handling (minimal)

**Verification:**
- [ ] User can tap on element in preview
- [ ] Element is highlighted and info displayed
- [ ] "Modify this element" sends context to chat
- [ ] AI responds with relevant changes
- [ ] Changes are applied and preview updates
- [ ] Works on both iOS Safari and Android Chrome
- [ ] Inspector can be toggled on/off

**Rollback:** Remove inspector toggle from MobilePreview. Inspector script changes are backward-compatible.

**Duration:** 2 weeks

---

## Stage 6: Add Save/Export Improvements

**Goal:** Improve the project save and export experience, especially for mobile users who need to get their code out of the browser.

**Tasks:**
1. Create `app/components/mobile/MobileExport.tsx`
   - "Download ZIP" button (using existing `downloadZip()` in WorkbenchStore)
   - "Copy to clipboard" — Copy selected file content
   - "Share" — Use Web Share API for sharing ZIP file
   - "Push to GitHub" — Using existing GitHub integration

2. Enhance `app/lib/stores/workbench.ts`
   - Add `shareProject()` method using Web Share API
   - Add `copyFileToClipboard(filePath)` method
   - Improve `downloadZip()` with progress indicator

3. Create project snapshot feature
   - Save project state to IndexedDB (already partially supported via snapshots)
   - "Save snapshot" button in mobile UI
   - "Restore snapshot" from chat history

4. Add auto-save indicator
   - Show save status in mobile header
   - Warn before navigating away from unsaved changes

5. PWA manifest improvements
   - Add proper `manifest.json` for "Add to Home Screen"
   - Service worker for offline chat history access
   - App icons for mobile home screen

**Files to Create:**
- `app/components/mobile/MobileExport.tsx`
- `public/manifest.json` (or enhance existing)

**Files to Modify:**
- `app/lib/stores/workbench.ts` — Add share/copy methods
- `app/components/mobile/MobileFiles.tsx` — Add export options
- `app/root.tsx` — Add PWA manifest link

**Verification:**
- [ ] ZIP download works on mobile
- [ ] Web Share API works on Android Chrome
- [ ] "Add to Home Screen" works on iOS and Android
- [ ] Project snapshots save and restore correctly
- [ ] Auto-save indicator shows correct status

**Rollback:** Remove export buttons. Existing download ZIP still works.

**Duration:** 1 week

---

## Stage 7: Later Integrations (Future)

These are explicitly out of scope for the initial MVP but documented for planning.

### GitHub Integration
- Push project to new/existing GitHub repository
- Pull changes from GitHub repository
- Create pull requests from mobile
- Branch management

### Supabase Integration
- Already partially implemented in palmkit.app
- Streamline the setup flow for mobile
- One-tap Supabase project creation
- Database schema management from chat

### Vercel Integration
- Already partially implemented in palmkit.app
- One-tap deploy to Vercel
- Deployment status in mobile UI
- Custom domain configuration

### Figma Integration
- Import Figma designs as project starting point
- Convert Figma frames to HTML/CSS
- Sync design changes to code

### Cloud Runner (Long-term)
- Run code on a cloud VM instead of WebContainer
- Enables Python, Rust, Go, and other runtimes
- Requires server infrastructure and billing

### MCP Integrations
- Already partially implemented in palmkit.app
- Add pre-configured MCP servers for common tools
- Filesystem, database, API integrations

---

## Dependency Graph

```
Stage 1 (Complete)
  └── Stage 2 (Mobile Shell)
       ├── Stage 3 (BYOK Onboarding)
       ├── Stage 4 (Project Rules/Skills)
       └── Stage 5 (Tap-to-Edit)
            └── Stage 6 (Save/Export)
                 └── Stage 7 (Integrations)
```

Stages 3, 4, and 5 can proceed in parallel after Stage 2 is complete.

---

## Success Criteria for MVP (Stages 1-5)

1. **Mobile-first experience**: A user can open the app on their phone, add an API key, select a model, start a chat, see a live preview, tap an element to edit it, and iterate on their project.
2. **Desktop preserved**: The existing desktop experience works exactly as it does in upstream palmkit.app.
3. **BYOK model**: The app never pays for LLM usage. Users provide their own API keys.
4. **No data loss**: Existing chat histories, projects, and settings are preserved.
5. **No upstream breakage**: Any palmkit.app update can be merged without conflicts in core files.

---

## Estimated Timeline

| Stage | Duration | Dependencies |
|-------|----------|-------------|
| Stage 1: Run Unmodified | Complete | None |
| Stage 2: Mobile Shell | 1-2 weeks | Stage 1 |
| Stage 3: BYOK Onboarding | 1 week | Stage 2 |
| Stage 4: Project Rules/Skills | 1 week | Stage 2 |
| Stage 5: Tap-to-Edit | 2 weeks | Stage 2 |
| Stage 6: Save/Export | 1 week | Stage 5 |
| Stage 7: Integrations | Ongoing | Stage 6 |

**Total MVP (Stages 1-5): ~5-7 weeks**
**Total with Save/Export (Stages 1-6): ~6-8 weeks**
