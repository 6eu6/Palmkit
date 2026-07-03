# VANGUARD Long-Session Test — Findings & Efficiency Report

_Run 2026-07-03 against the live Oracle worker (main) + real LLM (GLM-5.2 via
OpenRouter) + E2B. Build prompt: the detailed VANGUARD agency hero (React +
Vite + Tailwind, custom fonts, lucide icons, mobile menu, staggered
animations). Then a 5-step edit session on top of it._

---

## 1. Is the environment "hard-coded" / does it restrict the model?

**On the BUILD path — no, the model is free.** The Builder agent gets:

- The **full tool set**: `write_file, edit_file, read_file, delete_file,
  search_code, run_shell, update_todos, done` (`agent-registry.ts`).
- **80 steps** and **32 000 output tokens per step** — enough to write complete
  large files in one shot and to iterate for a 15–20 file project.
- Its **own real E2B sandbox** with a live shell (`run_shell`) — it can
  `npm install`, run a build, read errors, and fix them.
- **Free planning** via `update_todos` (it writes and checks off its own todo
  list — we saw "Todos 0/6 → 1/6 …" live).

The only genuinely "hard-coded" pieces are **hints and safety rails, not
constraints on creativity**:

| Piece | What it is | Does it limit the model? |
|-------|-----------|--------------------------|
| `planProject()` keyword app-type detection (react/vue/python/…) | Picks a runtime + a suggested file list from prompt keywords | No — the file list is a *hint*; the Builder decides the real files. |
| Builder "REQUIRED FILES" checklist for React/Vite | A reminder to include package.json, main, index.html, etc. | No — it's guidance; the model can add/remove freely. |
| Post-build entry-point check | Fails a build that has no runnable entry point | Safety gate only (prevents blank previews). |

So: **the build gives the model full agency.** VANGUARD was correctly
classified `react` and built with the model's own file choices.

**On the EDIT path — this is where freedom is removed.** A follow-up edit does
**not** run the agent at all. `generateEdit()` is a **single `generateText`
call**: no tools, no shell, no build check, no repair loop. The model must
return the whole changed files as one JSON blob. This asymmetry (rich agency for
builds, zero agency for edits) is the root of the edit-path weaknesses below.

---

## 2. What the long session actually did

| Step | Result | Time | Notes |
|------|--------|------|-------|
| VANGUARD build (run A, browser) | ✅ ready | — | 8 files, correct Vite React set |
| VANGUARD build (run B, direct) | ✅ ready | 35 s | **only 2 files** — under-generated but still shipped |
| VANGUARD build (run C, post-fix) | ✅ ready | 177 s | 9-file healthy set; **real `npm install && npm run build` passed (exit 0)** |
| Edit 1 — rename VANGUARD→NEXUS | ✅ ready | 130 s | |
| Edit 2 — add 4th stat | ✅ ready | 97 s | edit model re-added missing scaffolding → 8 files |
| Edit 3 — change hero lines | ✅ ready | 143 s | edited the full 8-file project |
| Edit 4 — solid white CTA | ✅ ready | 59 s | |
| Edit (post-fix, on run C) | ✅ ready | 47 s | 9 files, no error — confirms the timeout guard didn't break the happy path |

**No edit ever failed.** The "TIMEOUT" seen in the first browser run was an
artifact of my test harness's 180 s window — the product frontend polls
indefinitely (no give-up), so a user just sees ~1–2.5 min of progress, not a
failure.

---

## 3. The real problems found (ranked)

### P1 — Build non-determinism / soft verification
The same VANGUARD prompt produced **8 files once and 2 files another time**. A
2-file "React" app (e.g. `index.html` + `src/App.jsx`, no `package.json`, no
`main`) **cannot install or run**, yet it passed the entry-point gate and
shipped as `ready_for_preview`. Verification is soft: the hard build-check is
disabled for orchestrator builds (`job-processor.ts` — `wasOrchestrated = … ||
true`), so the only net is the Tester agent, which can finish without catching
an incomplete scaffold.
→ **FIXED (this session):** the worker now detects a Vite build that finished
**without `package.json`** and runs one Builder "finish the scaffolding" round
instead of shipping the broken 2-file preview.

### P2 — Edit calls have no timeout
`generateEdit` is one synchronous `generateText` with **no abort/timeout**. If
the provider hangs, the job sits "generating" until the 25-min stuck-job reaper.
→ **FIXED (this session):** a 5-min `AbortController` now bounds the edit call;
a hang fails cleanly and is retriable (normal latency is 60–150 s, so 5 min is
safe slack).

### P3 — Edit latency (1–2.5 min per edit)
Every edit re-generates **whole files** with a reasoning model at
`maxTokens: 64000`. For a trivial 3-line change on a small project it still took
~2 min. On a large `App.tsx` this risks truncation and is the main UX drag of a
long edit session. _(Recommendation, not yet changed — see §4.)_

### P4 — Edits are unverified
The edit path skips validation **and** the build check (`!editJobId` gate). A
broken edit ships without any compile check. _(Recommendation — see §4.)_

---

## 4. Efficiency recommendations (to raise, not yet applied)

1. **Verify edits.** After `generateEdit`, run the same E2B build check that
   builds get (or, for non-trivial edits, route through the agentic Builder with
   the existing repair loop). This closes P4 and would have caught any broken
   edit in the session.
2. **Cut edit latency (P3).** Options, best first:
   - Use a **faster / non-reasoning model for edits** (edits are mechanical;
     the heavy reasoning model is overkill).
   - Switch large files to **diff/patch output** instead of whole-file rewrite,
     so the model emits only the changed hunks.
   - Scale `maxTokens` to the project size instead of a flat 64 000.
3. **Re-enable the real build check for builds (P1).** The `|| true` that
   force-skips the standalone build-checker means a build's only verification is
   the LLM Tester. Running the actual E2B `npm run build` as a hard gate would
   catch compile errors and under-generation deterministically.
4. **Model choice for heavy builds.** GLM-5.2 is a reasoning model and is
   occasionally very slow (a build ranged 35 s → >7 min in this session). A
   faster/stronger model materially improves the experience on complex prompts.
5. **Builder determinism.** The model sometimes calls `done()` early. The new
   completion-retry helps; a lower Builder temperature or a stricter `done()`
   gate (refuse `done()` until the required entry files exist) would help more.

---

## 5. Fixes shipped in this session

- `external-worker/src/generator.ts` — `generateEdit` now runs under a 5-min
  `AbortController` (P2).
- `external-worker/src/orchestrator.ts` — the empty-Builder gate now also fires
  when a Vite build finished without `package.json`, giving one targeted
  completion round (P1).

Both were typechecked (`tsc` clean) and deployed to the live worker via
`deploy-worker.yml` (run succeeded), then re-verified with a fresh
build + edit on the real worker.
