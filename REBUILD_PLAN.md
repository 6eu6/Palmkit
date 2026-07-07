# Palmkit Radical Rebuild Plan

## Goal
Transform Palmkit from a rigid 4-agent pipeline (Researcher → Planner → Builder → Tester) into a true development environment with a single unified brain that reasons, plans, builds, verifies, and reports honestly.

## Core Principles
1. **No patching** — fix root causes, not symptoms
2. **No false reports** — verify every change with tests
3. **No performance-degrading workarounds** — clean solutions only
4. **Trust the model** — smart models (Kimi, GLM, DeepSeek) work better with clear simple instructions than with 185 lines of rules

## Phases

### Phase 0: Cleanup (delete dead code)
Delete ~450 lines of dead code that confuses models and developers:
- `ORCHESTRATOR_CONFIG` (never invoked)
- `take_screenshot` tool (superseded by `analyze_screenshot`)
- Phase 3/3.5 in job-processor (dead via `|| true`)
- Dead imports (`generateStaticFiles`, `generateEdit`, `runAgentBuild`, `checkBuild`)
- `<Clarifier>` component (permanently closed)
- Duplicate auto-screenshot in orchestrator
- Duplicate cases in BuildStream.tsx
- Redundant `.displayName` assignments

### Phase 1: Unified Brain (single agent)
Replace 4 separate agents with ONE agent that has all tools and decides its own flow:
- Delete `DEFAULT_AGENT_FLOW = ['researcher', 'planner', 'builder', 'tester']`
- Delete `Researcher`, `Planner`, `Builder`, `Tester` configs
- Create ONE `BRAIN_CONFIG` with all tools
- New system prompt that guides reasoning, acknowledgment, planning, building, verifying, honest completion
- The agent decides: simple task → work alone; complex task → spawn sub-agents

### Phase 2: Dynamic Sub-Agents
Add `spawn_subagent(task, context)` tool so the brain can delegate when it decides to:
- Sub-agent runs independently with a specific task
- Returns a text result to the brain
- Appears in the stream as a "Sub-agent: <task>" section
- The brain decides when to use it (not mandatory, not hardcoded)

### Phase 3: Clean Stream
Redesign the stream to show continuous reasoning → action → result → reasoning:
- New row types: `reasoning`, `acknowledgment`, `plan`, `tool_call`, `tool_result`, `subagent`, `summary`
- Remove per-agent section headers (System/Builder/Tester)
- Show the brain's thinking between every tool call
- Show tool calls with their arguments and results inline

### Phase 4: Honest Completion
Redesign `done()` to be explicit about what completed and what didn't:
- `completed`: list of what was built successfully
- `incomplete`: what didn't complete + why + suggestion
- `next_steps`: suggestions for the user

### Phase 5: Typed Events
Replace the `file_chunk` catch-all with typed events:
- `screenshot_captured`, `vision_analysis`, `video_generating`, `video_ready`
- `tool_call`, `tool_result`, `reasoning`, `acknowledgment`, `plan`
- `subagent_start`, `subagent_complete`, `build_summary`
- Eliminates `SELF_EMITTING_TOOLS` set and `payload.kind` string discrimination

## Expected Outcome
```
User writes prompt
    ↓
Brain reasons (visible in stream)
    ↓
Brain sends acknowledgment message to user
    ↓
Brain plans (logical todos, not just file list)
    ↓
Brain decides: need sub-agents?
    ├── yes → spawn sub-agents (parallel) → merge results
    └── no → continue alone
    ↓
Brain builds (write_file + reasoning between each file)
    ↓
Brain verifies (run_shell + analyze_screenshot)
    ↓
Brain fixes if needed (edit_file + rebuild)
    ↓
Brain completes honestly:
  ✅ what completed
  ⚠️ what didn't + why
  💡 next steps
```

## Verification
Every phase must be verified with:
1. TypeScript typecheck passes
2. Worker builds successfully
3. Live site test confirms the change works
4. No regressions in existing functionality

## Status
- [x] Phase 0: Cleanup (350 lines deleted, typecheck pass, worker deployed)
- [x] Phase 1: Unified Brain (single 'brain' agent replaces 4-agent pipeline, live test pass)
- [x] Phase 2: Dynamic Sub-Agents (spawn_subagent tool + subagent rows in stream)
- [x] Phase 3: Clean Stream (subagent rows + Brain icon + continuous flow)
- [ ] Phase 4: Honest Completion
- [ ] Phase 5: Typed Events
