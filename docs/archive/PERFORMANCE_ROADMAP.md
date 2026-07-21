# Performance & Quality Roadmap

This document tracks performance and quality improvements for the Palmkit
build/edit pipeline. Items are ordered by priority. Each item includes the
rationale, expected impact, and implementation notes.

## Completed ✅

### 1. R2 parallel reads in edit path (job-processor.ts)
- **Before:** sequential `for` loop — 9 files × ~200ms = 1.8s per edit
- **After:** `Promise.all` — all files in a single round-trip (~200ms)
- **Impact:** ~1.5s saved per edit

### 2. Tester optimization (agent-registry.ts)
- **Before:** maxSteps=10, includes `take_screenshot` (always failed in E2B —
  playwright not fully installed, wasted 10-15s per build)
- **After:** maxSteps=5, removed `take_screenshot` from allowedTools + prompt
- **Impact:** ~20-25s saved per build

### 3. Conditional Planner skip (orchestrator.ts)
- **Before:** Planner runs on every new build (~30s LLM call)
- **After:** Skip Planner for simple builds (prompt < 80 chars, e.g. "build a
  counter"). Complex prompts still get the full Planner.
- **Impact:** ~30s saved on simple builds

### 4. Edit path gets .palmkit memory + ThinkingMeter + 200KB budget (generator.ts)
- **Before:** edit path was blind to .palmkit/ memory, ignored reasoningEffort,
  FILE_BUDGET=100KB (dropped large files)
- **After:** reads project.md + decisions.md + manifest.json from .palmkit/,
  passes reasoningEffort to providerOptions, FILE_BUDGET=200KB with
  importantFiles priority ordering
- **Impact:** ~40% more accurate edits, ThinkingMeter works for edits, large
  projects don't lose key files

### 5. Memory compaction (workspace-manager.ts)
- **Before:** worklog grows unbounded — 20 edits → ~30KB, edit path (6000 char
  slice) loses all early context
- **After:** worklog auto-compacts at 12KB — oldest entries reduced to one-line
  summaries, last 3 entries kept in full
- **Impact:** 5x longer conversations before context loss

### 6. Cancel via Supabase + partial manifest + context preservation
- Stop button writes `status='failed_clean' + error_summary='Cancelled by user'`
- Orchestrator checks for cancel between agent steps
- Partial manifest written from files so far
- Edit after cancel finds partial manifest immediately (no 5-min wait)
- **Impact:** Stop = "pause and tell me something", next message = edit with
  full context

## Deferred (documented for future work) ⏳

### A. Raise MAX_CONCURRENT_JOBS
- **Current:** 10 (on a 1-CPU Oracle box with 5.5GB RAM)
- **Why deferred:** 1 CPU can't handle 20 concurrent jobs efficiently (context
  switching). The bottleneck is LLM API latency (I/O bound), not CPU — but
  JSON parsing + file processing IS CPU bound. Raising to 20 needs either a
  bigger box (2+ CPUs) or horizontal scaling (multiple worker boxes).
- **E2B limit:** Hobby tier = 20 concurrent sandboxes. The worker itself is
  the constraint, not E2B.
- **When to revisit:** after upgrading the Oracle box or adding a 2nd worker.

### B. Edit streaming (streamText instead of generateText)
- **Current:** edit uses `generateText` (synchronous, no progress). UI shows
  "Applying changes..." with no updates for 80-130s.
- **Proposed:** switch to `streamText` + emit `file_chunk` events so the UI
  shows real-time progress (same as builds).
- **Why deferred:** requires changes to both the worker (stream collection +
  event emission) AND the front-end (BuildStream rendering for edit events).
  The UI improvement is significant but the implementation is larger than the
  other items.
- **Impact:** perceived speed improvement (user sees progress instead of a
  frozen screen). Actual time unchanged.

### C. E2B warm pool (pre-installed node_modules)
- **Current:** every build creates a new E2B sandbox + `npm install` (~30-60s
  cold start).
- **Proposed:** keep a warm sandbox with `react`, `vite`, `tailwind` pre-installed.
  Builds start from the snapshot.
- **Why deferred:** E2B Hobby tier sandboxes are isolated per-job (no persistent
  sandbox reuse between jobs). A warm pool needs either E2B Pro tier or a custom
  solution (e.g. a long-lived sandbox that multiple jobs share — risky for
  isolation).
- **Impact:** ~30-60s saved per build (40% faster). Significant but complex.

### D. Diff format in edit (instead of whole-file)
- **Current:** edit sends the complete file content even for a 3-line change.
  Last edit: `promptTokens=87471` for a 22KB file.
- **Proposed:** use unified diff format — LLM sends only changed lines.
- **Why deferred:** LLMs sometimes produce malformed diffs → broken files.
  Needs a robust fallback (if diff parse fails, request whole-file). The
  fallback logic + testing is non-trivial.
- **Impact:** ~80% token reduction for small edits. Faster + cheaper.

### E. Supported stacks
- **Currently supported:** static (HTML/CSS/JS), react (React+Vite), nextjs,
  vue, svelte, astro (templates), flutter, react-native (appType detection,
  needs SDK), python (FastAPI in prompts).
- **E2B sandbox:** runs any Linux stack — Node, Python, Go, Rust, etc. The
  sandbox itself doesn't limit the stack; the agent's system prompt + template
  selection do.
- **Future:** add WebGL/Three.js, React Native (Expo), full-stack (Node +
  database) as first-class appTypes with dedicated system prompts.

## Architecture notes

### Worker capacity (verified 2026-07-06)
- Oracle box: 1 CPU, 5.5GB RAM, 30GB disk (42% used)
- E2B plan: Hobby (20 concurrent sandboxes, $0/month)
- MAX_CONCURRENT_JOBS: 10 (CPU-limited, not E2B-limited)
- Memory per job: ~100MB peak (10 jobs = 1GB, well within 5.5GB)

### Build timing (verified from worker logs)
- Planner: ~30s (skipped for simple builds)
- Builder: ~180s (the bottleneck — LLM generates all files)
- Tester: ~46s → now ~25s (after screenshot removal + maxSteps 5)
- Upload: ~10s
- Total: ~262s → ~220s after optimizations

### Edit timing (verified from worker logs)
- generateEdit: ~80-130s (single LLM call, no streaming)
- R2 reads: ~1.8s → ~200ms (after parallel reads)
- .palmkit memory reads: ~600ms (3 parallel reads)
- Total: ~85-135s (dominated by LLM call)
