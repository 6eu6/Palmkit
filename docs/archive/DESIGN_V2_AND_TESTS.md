# Design System v2 + Live-Test Log

_Source of truth for the v2 redesign and the model-router work. Updated
**before** any UI change, and after each live build test._

The full visual spec (palette, type, mockups, motion) lives in the published
design artifact; this file is the engineering record of what shipped and what
the live tests found.

---

## 1. What shipped (all live on palmkit.app / `main`)

### Brand & identity
- **Ice-cyan glass identity** derived from the product logo + loader (not the
  old monochrome). Tokens `--pk-accent #71E4FF` (dark) / `#0B90B4` (light),
  `--pk-accent-deep/-dim/-on-accent`, `--pk-glass-border(-hi)` in
  `app/styles/variables.scss`. Mobile accent system retinted to the brand cyan.
- **`PalmkitLoader`** (`app/components/ui/PalmkitLoader.tsx`) — the approved
  loader (glass card, dark mark, white light-trace 56/260 @1.55s, shine sweep).
  It is the **only** loading indicator in the product; it replaced every
  generic spinner in the build/preview flow (BuildStream header + agent
  sections + in-progress todos, preview "starting" state @64px, mobile status
  bar). `bare` variant for ≤24px inline slots.
- **No emoji in the UI** — icons are Phosphor SVGs matching the mark geometry.

### The composer (chat box)
- Single compact row. Provider/model/API-key sheet is **collapsed by default**
  behind a pill-style model chip (was expanded, ate half the phone screen).
- **Think chip** (brain icon): cycles Med → Max → Off, wired end-to-end (see §2).
- **Model Router** — "Models per task" grid: Brain / Builder / Tester are LIVE,
  Vision · Design and Media · Image/Video are stored (`soon`) for the media
  pipeline. Dark-styled `<select>` with a drawn accent caret.
- **Chat | Code** segmented mode toggle, visible from the first message.
- Accent send button with glow; brand focus ring; secondary tools behind a `+`
  on phones.

### Mobile
- Dock tabs: **Chat** and **App** (play icon) with a pulsing accent dot on App
  when files exist and the user is still in Chat.
- Workspace fills header→dock edge-to-edge (no floating card).
- **Projects drawer**: left side panel, brand-correct colors, closes on Escape,
  **drag-to-close** (follows the finger, closes past 35% or a fast fling),
  **edge-swipe** from the left 20px zone opens it.
- **Chat↔App swipe**: horizontal swipe on the content area switches the two dock
  destinations, synced with the dock pill; disabled inside editor/terminal/
  iframe and the left-edge drawer zone.
- Floating status bar shows **only** the sandbox-launch phase; the generation
  phase lives in the in-chat BuildStream card (killed the old duplication).

### Desktop
- Sidebar **pushes** the layout via `--sidebar-width` (no more overlap); header
  toggle + persistent panel; header content clears the sidebar; chat list
  refreshes on focus + a 15s poll.
- **Connections** group above the chat list (MCP Tools / Integrations) opening
  the settings panel on the right tab (`ControlPanel` gained `initialTab`).
- Glass workbench toolbar; Code/Diff/Preview slider uses the brand accent.

### Behavior / performance (Phase D)
- **Sandbox prewarm**: once a build passes 55% progress for an E2B app type,
  the preview sandbox is allocated in the background; the auto-launch reuses it
  at `ready_for_preview` (skips create, straight to pushing files). Only
  allocation is early — files/dev-server start at ready, so no stale preview.
- **Auto-preview**: verified build → sandbox launches → workbench opens on
  Preview automatically (mobile lands on the App tab). `pf_preview` cookie is
  per-chat (`sid:port:chatId`) so conversations don't cross-restore.
- **Unified failure card**: any `job_failed` renders one card in the chat —
  human reason + **Retry** (`palmkit:retry-build` → re-sends the last prompt) +
  **Show logs** (expands the stream). No silent fails, no raw stack traces.

### Preview transport (earlier rounds, still core)
- `/preview/` proxy relays WebSockets via `WebSocketPair` and echoes
  `Sec-WebSocket-Protocol` — fixes the Vite HMR reconnect/reload flash loop.
- Worker E2B sandbox has a **rolling TTL** + **dead-sandbox recreate/retry** so
  long builds don't lose their shell at minute 16.

---

## 2. Model Router + thinking control (how it flows)

```
composer (model-roles store)                 worker
  reasoningEffort: off|medium|max  ─┐
  modelRoles: {brain,builder,tester}│  POST /api/jobs
                                    └─►  validation_result.{reasoningEffort,modelRoles}
                                              │  job-processor.ts
                                              ├─ getModelInstance() per role
                                              └─ runOrchestratedBuild(..., {agentModels, reasoningEffort})
                                                     orchestrator.ts
                                                       ├─ agentModel per role (researcher/orchestrator→brain,
                                                       │                        builder→builder, tester→tester)
                                                       └─ providerOptions.openrouter.reasoning
                                                            off → {enabled:false}
                                                            medium → {effort:'medium'}
                                                            max → {effort:'high'}
```
Empty role = main model. `off` skips reasoning tokens entirely for speed/cost.

---

## 3. Live-test log

### 2026-07-04 — weather dashboard (React+Vite+TS+Tailwind), production
- **Result:** ✅ ready + build verified in ~8 min (job `076c686d`), 10 files,
  4 agents. Auto-preview fired: iframe live at `/preview/`, workbench opened on
  Preview with no manual clicks. Zero console errors on the running app.
- **Prewarm:** confirmed — sandbox allocated during the build and reused at
  launch (auto-preview surfaced quickly after `ready_for_preview`).
- **Repair loop:** the Tester hit an intermediate TypeScript error
  (`cannot find module './index.css'` — missing `vite-env.d.ts`), the worker's
  repair round fixed it, and the build ended verified ✓. The **unified failure
  card did NOT render** (correct — no `job_failed`; it only shows on a terminal
  failure).
- **Bugs found & fixed this session:**
  1. **Tester step-limit banner showed on a verified build.** The old
     suppression looked for "BUILD PASSED" in the Tester's text, but this
     Tester's text held the intermediate "BUILD FAILED" line, so the scary
     banner slipped through even though the build verified. **Fix:** never emit
     the step-limit banner for the Tester (its cap is not user-actionable — the
     real outcome is reported separately); keep it only for the Builder.
  2. **Recurring `vite-env.d.ts` omission** cost a repair round on nearly every
     TS build. **Fix:** the Builder's REQUIRED-FILES checklist now mandates
     `src/vite-env.d.ts` (`/// <reference types="vite/client" />`) for
     TypeScript projects, so the CSS-import type error never happens.

### Earlier (2026-07-03) — 3 parallel builds (Lithos / Ledgerly / Nexera)
See `LIVE_TEST_REPORT_2026-07-03.md` for the full findings that seeded the
preview, mobile-layout, auto-launch, per-chat-scope and sandbox-TTL fixes.

---

### 2026-07-04 — media pipeline v1 (generate_image), production
- **Result:** ✅ end-to-end. Prompt: a coffee brand needing a real logo + hero.
  The Builder called `generate_image` for both; each was generated on
  OpenRouter (google/gemini-2.5-flash-image), compressed with jimp (logo → PNG
  @512, hero → JPEG @1280), written as a data-URI TS module, streamed inline,
  and the build verified ✓. The **live preview renders both**: the generated
  logo in the navbar and the café hero as the full-screen background, over the
  "Crafted for the ritual" headline. This is exactly the "design me a
  logo/hero and use it" scenario.
- **Bugs found & fixed across three iterations (all live-verified):**
  1. Raw model output was 1–2 MB per image — too heavy to bundle and too big
     for the preview pipeline. **Fix:** jimp compression (logo 238KB→67KB PNG;
     photos → ~15–150KB JPEG).
  2. Even compressed (119/184KB), the asset modules exceeded the 100KB
     `file_written` inline cap and fell through to the workspace list-fetch,
     which returns 0 for these jobs — so they never reached the preview
     sandbox. **Fix:** raised the inline cap to 300KB (module constant, applied
     everywhere) so compressed assets stream on the reliable Realtime path.
     Final run: logo 89KB + hero 147KB, both `inlined: true`, preview renders.
  3. Auto-launch raced the file fetch (pushed on the first file). **Fix:** wait
     until the file count is non-zero and stable across two checks before
     launching.
- **Known refinement:** the Media-role dropdown lists the user's text models;
  most users leave it empty → DEFAULT_IMAGE_MODEL is used and works. A future
  pass can list image-output models there. Video generation is a later slice.

### 2026-07-05 — brain-led media (Planner phase), production
The media pipeline was "dumb": `generate_image` lived on the Builder, which
improvised an image prompt mid-stream with **no design context** — so assets
came out random/off-theme (and, before the flood-fill fix, white-boxed). The
deeper cause: the "brain" never actually led the design. `DEFAULT_AGENT_FLOW`
was `Researcher → Builder → Tester`, the Researcher is **skipped on new
projects**, and the Orchestrator-LLM plan was dead code — so on a new build the
**Builder did everything alone**, including deciding what art to make.

**Fix — a real design brain, applied the way a coding agent actually works
(understand fully → form design intent → execute in context):**
- New **Planner** agent (`agent-registry.ts:PLANNER_CONFIG`, role `planner`,
  runs on the **brain** model). Read-only (`list_uploads` / `read_file` /
  `list_files`), no code. It emits an **art-directed brief**: IDENTITY, a real
  DESIGN SYSTEM (hex palette + type + style), and a **MEDIA PLAN** — for each
  asset: `name`, `kind`, `placement` (exact region/component), `animated`
  (how), `transparent`, and a palette-referencing `prompt`. It reconciles with
  user **uploads** (reuse an uploaded logo, don't regenerate) and returns an
  **empty plan** when the app needs no imagery (dashboards/tools) — no
  decorative filler.
- Flow is now `Researcher → Planner → Builder → Tester`. Complementary gating:
  **new** project → Researcher skipped, **Planner runs** (design lead); **edit**
  → Researcher runs, **Planner skipped** (reuses the saved brief).
- The Builder's IMAGES section now says **follow the brief**: call
  `generate_image` with the plan's exact name+prompt, place each asset in its
  specified region, and implement the specified animation in code (CSS/parallax/
  ken-burns). Integration stays the code model's job — contextual, not blind.
- The brief is persisted to `.palmkit/design-brief.md`
  (`orchestrator.ts`), so later **edits stay on-brand** (same identity/palette/
  logo) without re-running the brain. Graceful degradation everywhere: no
  brief → Builder uses judgment; empty text → plain build.

This is "the models talk to each other, led by the brain": the brain decides
**intent + placement + art direction**, the code model **generates + integrates
in context**. Typecheck ✓, lint ✓; pushed to `main` (worker auto-deploys).
_Pending live build test to confirm a new project's Planner brief drives an
on-theme, correctly-placed asset set end-to-end._

## 4. Remaining (per the design doc)
- **Image generation is live** and now **brain-directed** (Planner brief →
  Builder execution). Remaining: VIDEO generation (e.g. animate an uploaded
  image into a hero clip) and the Vision · Design role (visual reasoning over
  uploaded images / screenshots for logo suggestions & design review). Both
  slot cleanly into the brief: the MEDIA PLAN already carries `animated` and a
  per-asset `kind`, so a `kind: video` entry + a Vision pass that reviews the
  rendered result are the natural next increments.
