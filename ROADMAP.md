# Palmkit — Roadmap الكامل

> آخر تحديث: 2026-06-30
> الحالة: منتج يعمل بنظام وكلاء متعددين + ورك سبيس ذكي

---

## الحالة الحالية (أين نحن الآن)

### ✅ مكتمل ويعمل في الإنتاج

#### 1. البناء (Build System)
- [x] External Worker (Oracle VM + Bun) — يعمل
- [x] Agent Builder (generateText + 11 أداة) — يعمل
- [x] Multi-Agent Orchestrator (Researcher → Builder → Tester) — يعمل
- [x] E2B Sandbox لأوامر shell — يعمل
- [x] نظام الصلاحيات (كل وكيل يأخذ subset من الأدوات) — يعمل
- [x] dynamic maxTokens حسب النموذج — يعمل
- [x] maxSteps: 50 (Builder), 15 (Tester), 10 (Researcher) — يعمل

#### 2. الورك سبيس (Workspace)
- [x] R2 موحد: `projects/{chatId}/workspace/` — يعمل
- [x] worklog.md (ذاكرة المشروع) — يعمل
- [x] manifest.json ذكي (stack, entrypoints, commands, apiRoutes, qualityGates) — يعمل
- [x] `.palmkit/` memory layer (6 ملفات: project.md, decisions.md, agent-instructions.md, api-map.json, file-map.json, test-results.json, errors.json) — يعمل
- [x] uploads/ folder + POST /api/workspace — يعمل
- [x] downloads/ folder + GET ?action=download — يعمل
- [x] data/schema.prisma + Prisma + SQLite — يعمل

#### 3. الأدوات (11 أداة)
- [x] write_file — كتابة ملف
- [x] edit_file — تعديل جزء محدد
- [x] read_file — قراءة ملف (ذاكرة + R2)
- [x] list_files — عرض كل الملفات
- [x] delete_file — حذف ملف
- [x] search_code — بحث بنمط regex
- [x] list_uploads — عرض ملفات المستخدم
- [x] run_shell — تنفيذ أمر في E2B
- [x] run_tests — تشغيل الاختبارات
- [x] take_screenshot — لقطة شاشة (Playwright في E2B)
- [x] done — إنهاء البناء

#### 4. المعاينة (Preview)
- [x] E2B sandbox للمعاينة (للجوال + الديسكتوب) — يعمل
- [x] Launch Preview button — يظهر للتطبيقات غير static
- [x] blob URL للتطبيقات static — يعمل
- [x] استرجاع الملفات بعد التحديث (/api/workspace) — يعمل
- [x] appType detection (React/Vue/Nextjs/Python/Static) — يعمل

#### 5. الواجهة (Frontend)
- [x] Sidebar يظهر افتراضياً على desktop — يعمل
- [x] chatStarted fix (المحادثة تفتح عند الضغط) — يعمل
- [x] Code tab يعرض شجرة الملفات — يعمل
- [x] Mobile viewport (390x844) — يعمل
- [x] تبديل النماذج (model selector) — يعمل

#### 6. MCP Integration (موجود جزئياً)
- [x] MCP Service (app/lib/services/mcpService.ts) — 457 سطر
- [x] MCP Store (app/lib/stores/mcp.ts) — إعدادات + maxLLMSteps
- [x] MCP Tab في الإعدادات (إضافة/حذف MCP servers)
- [x] يدعم: stdio, SSE, StreamableHTTP
- [x] تكامل مع api.chat.ts (processToolInvocations)
- [ ] غير متصل بالـ Worker agents (MCP للواجهة فقط، ليس للوركر)

---

### ❌ غير مكتمل / يحتاج عمل

#### Playwright كامل
- **الحالة الحالي**: `take_screenshot` يستخدم Playwright داخل E2B لكن بشكل بدائي (node -e script)
- **المشكلة**: 
  - الـ script صغير جداً (title + bodyText فقط)
  - لا يدعم click, type, scroll, inspect console, inspect network
  - يحتاج dev server يعمل أولاً (وكل خطوة تختصر sandbox)
- **المطلوب**:
  - `browser_open(url)` — فتح صفحة
  - `browser_click(selector)` — نقر عنصر
  - `browser_type(selector, text)` — كتابة نص
  - `browser_screenshot()` — لقطة شاشة كاملة
  - `browser_console_logs()` — قراءة console errors
  - `browser_network_logs()` — قراءة network requests
  - `browser_wait_for(selector)` — انتظار عنصر
- **التحدي**: E2B sandbox مؤقت (يُدمر بعد كل أمر). لا يمكن إبقاء المتصفح مفتوحاً بين الأوامر. الحل: أمر واحد ينفذ كل خطوات Playwright في script واحد.

#### Git Layer
- **الحالة الحالي**: غير موجود تماماً في الـ worker
- **المشكلة**: لا يوجد تتبع للتغييرات، لا rollback، لا branches
- **المطلوب**:
  - `git_init()` — تهيئة git في الـ workspace
  - `git_status()` — عرض الملفات المتغيرة
  - `git_diff()` — عرض التغييرات
  - `git_commit(message)` — حفظ التغييرات
  - `git_revert()` — التراجع عن آخر commit
  - `git_log()` — عرض التاريخ
- **التحدي**: الـ workspace في R2 (مش filesystem محلي). الحل: تنفيذ git في E2B sandbox.

#### MCP للـ Worker Agents
- **الحالة الحالي**: MCP يعمل في الواجهة (api.chat.ts) لكن ليس في الـ worker
- **المشكلة**: الـ worker agents (Researcher, Builder, Tester) لا يستطيعون استخدام MCP tools
- **المطلوب**: ربط MCP service بالـ orchestrator بحيث:
  - الـ Orchestrator يقرأ MCP config من Supabase
  - يمرر MCP tools للوكلاء كأدوات إضافية
  - كل وكيل يستطيع استخدام MCP tools المسموحة له

#### وكلاء جدد (الجلسة القادمة)
- [ ] Security Agent — فحص أمني (secrets, vulnerabilities, RLS)
- [ ] Marketing Agent — محتوى تسويقي (landing pages, copy, SEO)
- [ ] Design Agent — تحسين تصميم (colors, spacing, typography, UX)
- [ ] Git Agent — إدارة Git (branch, commit, PR)
- [ ] Debug Agent — تشخيص وإصلاح الأخطاء

#### التوسع (Scaling)
- [ ] نشر 10 وركرات (Oracle Cloud)
- [ ] Cloudflare Queues لتوزيع العمل
- [ ] E2B snapshots (palmkit-cache-react, palmkit-cache-vue)
- [ ] Supabase Realtime (بدل polling)
- [ ] Auto-scaling (scale up/down حسب الطلب)

---

## Roadmap المراحل

### المرحلة 1: استقرار (مكتملة ✅)
**المدة**: مكتملة
**الحالة**: يعمل في الإنتاج

- [x] نظام البناء (agent-builder + generateText)
- [x] E2B sandbox لأوامر shell
- [x] workspace موحد في R2
- [x] worklog + manifest
- [x] معاينة E2B للجوال والديسكتوب
- [x] استرجاع الملفات بعد التحديث
- [x] نظام الصلاحيات للوكلاء

### المرحلة 2: ورك سبيس ذكي (مكتملة ✅)
**المدة**: مكتملة
**الحالة**: يعمل في الإنتاج

- [x] `.palmkit/` memory layer (6 ملفات)
- [x] smart manifest (stack, entrypoints, commands, apiRoutes)
- [x] search_code tool
- [x] edit_file tool
- [x] delete_file tool
- [x] run_tests tool
- [x] take_screenshot tool
- [x] uploads/downloads support
- [x] Prisma + SQLite support

### المرحلة 3: وكلاء متعددين (مكتملة ✅)
**المدة**: مكتملة
**الحالة**: يعمل في الإنتاج

- [x] Orchestrator (منسق)
- [x] Researcher (قراءة فقط)
- [x] Builder (كتابة + shell)
- [x] Tester (تحقق + screenshot)
- [x] نظام صلاحيات (permission model)

### المرحلة 4: Playwright كامل (التالية)
**المدة**: 1-2 جلسة
**الحالة**: غير مبدوءة

- [ ] `browser_open(url)` — فتح صفحة في E2B
- [ ] `browser_click(selector)` — نقر عنصر
- [ ] `browser_type(selector, text)` — كتابة نص
- [ ] `browser_screenshot()` — لقطة شاشة كاملة
- [ ] `browser_console_logs()` — قراءة console
- [ ] `browser_network_logs()` — قراءة network
- [ ] `browser_wait_for(selector)` — انتظار عنصر
- [ ] دمج Playwright script كأمر واحد في E2B (لأن sandbox مؤقت)

**التحدي الرئيسي**: E2B sandbox يُدمر بعد كل أمر. لا يمكن إبقاء المتصفح مفتوحاً. الحل: إنشاء script كامل ينفذ كل خطوات الاختبار في أمر واحد:
```javascript
// مثال: browser_test script
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:3000');
  await page.click('button.increment');
  await page.screenshot({ path: '/tmp/screenshot.png' });
  const logs = await page.evaluate(() => console.logs);
  console.log(JSON.stringify({ screenshot: '...', logs }));
  await browser.close();
})();
```

### المرحلة 5: Git Layer (التالية)
**المدة**: 1 جلسة
**الحالة**: غير مبدوءة

- [ ] `git_init()` — تهيئة git repo في workspace
- [ ] `git_status()` — عرض الملفات المتغيرة
- [ ] `git_diff()` — عرض التغييرات
- [ ] `git_commit(message)` — حفظ التغييرات
- [ ] `git_revert()` — التراجع
- [ ] `git_log()` — عرض التاريخ
- [ ] ربط Git مع .palmkit/last-diff.patch

**التحدي**: الـ workspace في R2. الحل: تنفيذ git في E2B sandbox:
1. اكتب الملفات من R2 إلى sandbox
2. نفذ git commands
3. اقرأ النتائج
4. دمر الـ sandbox

### المرحلة 6: MCP للـ Worker (التالية)
**المدة**: 1 جلسة
**الحالة**: MCP موجود في الواجهة فقط

- [ ] قراءة MCP config من Supabase في الـ worker
- [ ] إنشاء MCP client في الـ worker
- [ ] تمرير MCP tools كأدوات إضافية للوكلاء
- [ ] نظام صلاحيات لـ MCP tools (كل وكيل يأخذ subset)
- [ ] دعم stdio, SSE, StreamableHTTP

**المتطلبات**:
- تثبيت `@modelcontextprotocol/sdk` في الـ worker
- إنشاء MCP client في الـ worker (مش الواجهة)
- تخزين MCP config في Supabase (مش localStorage)

### المرحلة 7: وكلاء متخصصين (الجلسة القادمة)
**المدة**: 2-3 جلسات
**الحالة**: غير مبدوءة

#### 7A. Security Agent
- [ ] فحص secrets في الكود
- [ ] فحص dependency vulnerabilities (npm audit)
- [ ] فحص RLS policies (Supabase)
- [ ] فحص auth bypass
- [ ] فحص CORS
- [ ] فحص unsafe eval
- [ ] فحص file upload risks
- [ ] أدوات: secret_scan, dependency_audit, static_analysis

#### 7B. Design Agent
- [ ] تحسين الألوان (contrast, palette)
- [ ] تحسين spacing (padding, margin)
- [ ] تحسين typography (font sizes, line heights)
- [ ] تحسين responsive design
- [ ] تحسين animations
- [ ] أدوات: take_screenshot, read_file, edit_file, search_code

#### 7C. Marketing Agent
- [ ] كتابة landing page copy
- [ ] تحسين SEO (meta tags, headings)
- [ ] كتابة README.md
- [ ] كتابة CHANGELOG.md
- [ ] أدوات: write_file, edit_file, read_file, search_code

#### 7D. Debug Agent
- [ ] قراءة error logs
- [ ] تشخيص السبب الجذري
- [ ] اقتراح patch صغير (لا يعيد كتابة المشروع)
- [ ] أدوات: read_file, search_code, run_shell, edit_file

#### 7E. Git Agent
- [ ] إنشاء branch
- [ ] تلخيص diff
- [ ] كتابة commit message
- [ ] فتح PR (لو مربوط بـ GitHub)
- [ ] أدوات: git_status, git_diff, git_commit, git_log

### المرحلة 8: التوسع لـ 1000 مستخدم
**المدة**: 2-3 جلسات
**الحالة**: وركر واحد (10 وظائف متزامنة)

- [ ] نشر 10 وركرات على Oracle Cloud
- [ ] Cloudflare Queues لتوزيع العمل
- [ ] E2B snapshots (palmkit-cache-react, palmkit-cache-vue)
- [ ] Supabase Realtime (بدل polling كل 1.5s)
- [ ] Auto-scaling (scale up عند > 20 وظيفة منتظرة)
- [ ] مراقبة (dashboard للـ worker pool health)

---

## إحصائيات المشروع الحالية

| المقياس | القيمة |
|---------|--------|
| إجمالي commits | 1927 |
| ملفات TypeScript | 445 |
| أدوات الوكلاء | 11 |
| عدد الوكلاء | 4 (Orchestrator + Researcher + Builder + Tester) |
| ملفات .palmkit/ | 7 |
| API endpoints | 8 (list, file, worklog, manifest, download, uploads, POST upload, health) |
| Worker deployments | 34 |
| CF Pages deployments | 30+ |

## المعمارية الحالية (مخطط)

```
المستخدم (جوال/ديسكتوب)
    ↓
palmkit.app (Cloudflare Pages)
    ├── /chat/{id} — واجهة المحادثة
    ├── /api/jobs — إضافة/فحص البناء
    ├── /api/workspace — قراءة/كتابة الملفات
    ├── /api/sb — E2B sandbox proxy
    └── /api/files — legacy file access
    ↓
Supabase (PostgreSQL + Storage + Auth)
    ├── build_jobs (queue)
    ├── job_events (progress)
    ├── project_files_manifest
    └── Storage: palmkit-files bucket
    ↓
Worker Pool (Oracle VM — 1 worker حالياً)
    ├── Orchestrator
    │   ├── Researcher (read-only: 5 tools)
    │   ├── Builder (write: 7 tools)
    │   └── Tester (verify: 6 tools)
    ├── E2B Sandbox (run_shell, run_tests, take_screenshot)
    └── R2 (projects/{chatId}/workspace/)
        ├── .palmkit/ (7 memory files)
        ├── src/ (code)
        ├── data/ (schema.prisma, db.sqlite)
        ├── uploads/ (user files)
        ├── downloads/ (generated outputs)
        ├── worklog.md
        └── manifest.json
```

## الأولويات القادمة (بالترتيب)

1. **Playwright كامل** — يحتاج script موحد في E2B (ليس أوامر منفصلة)
2. **Git layer** — يحتاج git في E2B sandbox
3. **MCP للـ worker** — يحتاج MCP client في الـ worker
4. **وكلاء جدد** — Security, Design, Marketing, Debug, Git
5. **التوسع** — 10 وركرات + Queues + snapshots + Realtime

---

## Agentic Platform Roadmap v2 (merged from AGENTIC_ROADMAP.md)

_Merged from the standalone AGENTIC_ROADMAP.md during P2 cleanup._


> **Status**: Active development
> **Last updated**: 2026-06-29
> **Author**: Architecture review based on full codebase audit

---

## Executive Summary

Palmkit already has 80% of the infrastructure needed to be a true agentic IDE.
The gaps are not in "missing technologies" but in **wiring existing capabilities
together**. This roadmap focuses on **maximizing existing assets** rather than
adding new layers.

### Key Findings from Audit (2026-06-29)

1. **The Oracle worker is already optional** — opt-in via `localStorage.palmkit_use_external_worker`.
   The default path (browser → CF Pages streaming → LLM → action-runner → WebContainer/E2B)
   works without it.

2. **CF Pages streaming has NO 30s wall-clock limit** — `api.chat.ts` returns
   `text/event-stream` which is exempt from the CPU-time cap. The 120s timeout
   is self-imposed by `StreamRecoveryManager`.

3. **The chat path already supports agent loops** — `maxSteps: maxLLMSteps`
   (default 5) with `onStepFinish` processing tool calls. MCP tools are wired
   in (`tools: mcpService.toolsWithoutExecute`).

4. **E2B SDK v2.29.1 supports full agent capabilities** — `sandbox.files`,
   `sandbox.commands`, `sandbox.pty`, `sandbox.git`, plus `pause()`/`resume()`
   for cost optimization.

5. **The infrastructure exists but is underutilized** — the worker can read
   files back (`getFileText`) but doesn't; `Bun.spawn` exists but only for
   `bun build`; MCP is wired in chat but no built-in tools.

---

## Phase 1: Unlock Existing Capabilities (Week 1)

**Goal**: Make the chat path a true agent loop without adding new infrastructure.

### 1.1 Increase `maxLLMSteps` and add smart defaults

**File**: `app/lib/stores/mcp.ts:13`

```typescript
// Before:
maxLLMSteps: 5,

// After: dynamic based on task complexity
maxLLMSteps: 15,  // enough for: generate → build → fix → rebuild → verify
```

**Effort**: S (1 line change)
**Impact**: High — LLM can now iterate to success

### 1.2 Add built-in tools to the chat path

**File**: `app/lib/.server/llm/built-in-tools.ts` (new)

Add these tools that the LLM can call during generation:

```typescript
export const builtInTools = {
  // Read a file from the current project (R2 or workbench)
  read_file: tool({
    description: 'Read a file from the current project',
    parameters: z.object({ path: z.string() }),
    execute: async ({ path }) => { /* read from R2/workbench */ }
  }),

  // Run a shell command in the sandbox (E2B or WebContainer)
  run_shell: tool({
    description: 'Run a shell command in the preview sandbox',
    parameters: z.object({ command: z.string() }),
    execute: async ({ command }) => { /* sandbox.commands.run */ }
  }),

  // List files in the project
  list_files: tool({
    description: 'List all files in the current project',
    parameters: z.object({}),
    execute: async () => { /* list from workbench */ }
  }),

  // Search the web (for docs/examples)
  web_search: tool({
    description: 'Search the web for documentation or examples',
    parameters: z.object({ query: z.string() }),
    execute: async ({ query }) => { /* call search API */ }
  }),
};
```

**Wire into**: `app/routes/api.chat.ts:262`
```typescript
tools: {
  ...mcpService.toolsWithoutExecute,
  ...builtInTools,  // ← ADD THIS
},
```

**Effort**: M (4-6 hours)
**Impact**: Critical — LLM can now verify its own output

### 1.3 Add runtime verification step

**File**: `app/lib/runtime/verifier.ts` (new)

After file generation, before showing "ready":

```typescript
export async function verifyProject(
  files: FileMap,
  appType: string,
  sandbox?: Sandbox
): Promise<{ ok: boolean; errors: string[] }> {
  if (appType === 'static') {
    // For static: just check index.html exists and is valid
    return verifyStaticHtml(files);
  }

  if (sandbox) {
    // For React/Vue: run build + check dev server responds
    await sandbox.commands.run('npm install', { timeout: 60000 });
    const build = await sandbox.commands.run('npm run build', { timeout: 90000 });
    if (build.exitCode !== 0) return { ok: false, errors: [build.stderr] };

    // Start dev server, curl localhost, check 200
    await sandbox.commands.run('npm run dev &', { background: true });
    await sleep(5000);
    const curl = await sandbox.commands.run('curl -s -o /dev/null -w "%{http_code}" http://localhost:5173');
    if (curl.stdout.trim() !== '200') {
      return { ok: false, errors: ['Dev server not responding'] };
    }
  }

  return { ok: true, errors: [] };
}
```

**Effort**: M (6 hours)
**Impact**: High — "builds" becomes "works"

### 1.4 Replace polling with Supabase Realtime

**File**: `app/lib/hooks/use-external-worker.ts`

```typescript
// Before: poll every 1.5s
const POLL_INTERVAL_MS = 1500;

// After: subscribe to Supabase Realtime
useEffect(() => {
  const channel = supabase
    .channel(`job:${jobId}`)
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'build_jobs',
      filter: `id=eq.${jobId}`
    }, (payload) => {
      updateState(payload.new);
    })
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'job_events',
      filter: `job_id=eq.${jobId}`
    }, (payload) => {
      addEvent(payload.new);
    })
    .subscribe();

  return () => { supabase.removeChannel(channel); };
}, [jobId]);
```

**Effort**: S (2 hours)
**Impact**: Medium — instant updates, less server load

---

## Phase 2: Smart Resource Management (Week 2)

**Goal**: Serve 100+ concurrent users without scaling costs.

### 2.1 Lazy sandbox with pause/resume

E2B supports `pause()` (cheap) and `resume()` (instant). Use this instead of
destroy + recreate.

**File**: `app/lib/sandbox/remoteSandbox.ts`

```typescript
// When user leaves (7 min idle): pause, don't destroy
export async function pauseSandbox(id: string): Promise<void> {
  const sandbox = await E2BSandbox.connect(id);
  await sandbox.pause();  // ~$0.01/hour vs $0.05/hour running
}

// When user returns: resume from paused state
export async function resumeSandbox(id: string): Promise<string> {
  const sandbox = await E2BSandbox.connect(id);  // auto-resumes if paused
  return sandbox.sandboxId;
}
```

**Effort**: S (2 hours)
**Impact**: 80% cost reduction on idle sandboxes

### 2.2 Snapshot caching for instant boot

E2B snapshots are free to store. Pre-build snapshots for common frameworks:

```typescript
// One-time setup: create snapshots for each framework
const frameworks = ['vite-react', 'vite-vue', 'nextjs', 'node-express'];
for (const fw of frameworks) {
  const sb = await E2BSandbox.create();
  await sb.commands.run(`npx create-${fw} app && cd app && npm install`);
  await E2BSandbox.createSnapshot(sb.sandboxId, { name: `palmkit-cache-${fw}` });
  await sb.kill();
}
```

Then when a user starts a React project, boot from `palmkit-cache-vite-react`
snapshot (instant, node_modules pre-installed).

**Effort**: M (4 hours)
**Impact**: 10-15s faster preview boot

### 2.3 Sandbox reuse for edits

When user sends an edit prompt, DON'T destroy the sandbox. Just update the
changed files:

```typescript
export async function applyEdit(
  sandboxId: string,
  changedFiles: Record<string, string>
): Promise<void> {
  const sandbox = await E2BSandbox.connect(sandboxId);

  for (const [path, content] of Object.entries(changedFiles)) {
    await sandbox.files.write(`/home/user/app/${path}`, content);
  }

  // Vite HMR will auto-reload — no need to restart dev server
}
```

**Effort**: S (3 hours)
**Impact**: Eliminates sandbox creation cost on edits

### 2.4 Decide on the Oracle worker

**Recommendation**: Keep it as an **optional fallback**, not the default.

The default chat path (CF Pages streaming) handles 95% of cases. The worker
is only needed when:
- User wants background processing (close tab, come back later)
- User is on a metered mobile connection (less streaming)
- User explicitly enables it for "power user" mode

**Action**: Set `palmkit_use_external_worker` to `false` by default (already is),
document it as "experimental background mode".

**Effort**: S (documentation only)
**Impact**: Simpler default flow, worker remains for power users

---

## Phase 3: Agentic Intelligence (Week 3-4)

**Goal**: Palmkit becomes a true agentic IDE, not just a generator.

### 3.1 Model router

**File**: `app/lib/llm/model-router.ts` (new)

```typescript
export function selectModelForTask(
  prompt: string,
  context: { hasCode: boolean; complexity: 'low' | 'medium' | 'high' }
): { provider: string; model: string } {
  const lower = prompt.toLowerCase();

  // Frontend/UI → Claude (best at design)
  if (/landing|hero|component|css|animation|design|ui/.test(lower)) {
    return { provider: 'Anthropic', model: '~anthropic/claude-sonnet-latest' };
  }

  // Backend/logic → DeepSeek (cost-effective for code)
  if (/api|backend|database|sql|endpoint|server/.test(lower)) {
    return { provider: 'OpenRouter', model: 'deepseek/deepseek-chat' };
  }

  // Reasoning → o1/Claude thinking
  if (context.complexity === 'high') {
    return { provider: 'OpenAI', model: '~openai/o1-mini' };
  }

  // Default → user's selected model
  return { provider: userProvider, model: userModel };
}
```

**Effort**: M (4 hours)
**Impact**: Better quality, lower cost (right model for right task)

### 3.2 Project context store

**File**: `supabase/migrations/0010_project_context.sql` (new)

```sql
CREATE TABLE project_context (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id),

  -- What the agent learned about this project
  app_type text,                    -- 'react' | 'nextjs' | 'static' | ...
  framework text,                   -- 'vite' | 'next' | 'remix' | ...
  styling text,                     -- 'tailwind' | 'css-modules' | ...
  state_management text,            -- 'zustand' | 'redux' | 'context' | ...
  key_dependencies text[],          -- ['react-query', 'axios', 'zod']

  -- Agent memory (like worklog.md but per-project)
  decisions jsonb DEFAULT '[]',    -- [{step, decision, reason, timestamp}]
  known_errors jsonb DEFAULT '[]', -- [{error, fix, timestamp}]
  patterns jsonb DEFAULT '[]',     -- [{pattern, usage, example}]

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Vector embeddings for semantic search across projects
ALTER TABLE project_context
  ADD COLUMN embedding vector(1536);

CREATE INDEX ON project_context USING ivfflat (embedding vector_cosine_ops);
```

**Effort**: M (6 hours)
**Impact**: Agent "remembers" project decisions across sessions

### 3.3 Parallel sub-agents for complex builds

**File**: `app/lib/agent/orchestrator.ts` (new)

```typescript
export async function orchestrateComplexBuild(
  prompt: string,
  projectId: string
): Promise<void> {
  // 1. Decompose the task
  const plan = await planTasks(prompt);
  // e.g., [{task: 'frontend', deps: []}, {task: 'backend', deps: []}, {task: 'integration', deps: ['frontend', 'backend']}]

  // 2. Run independent tasks in parallel (each in its own E2B sandbox)
  const parallel = plan.filter(t => t.deps.length === 0);
  const results = await Promise.all(
    parallel.map(task => runSubAgent(task, projectId))
  );

  // 3. Run dependent tasks sequentially
  for (const task of plan.filter(t => t.deps.length > 0)) {
    await runSubAgent(task, projectId, results);
  }
}
```

**Effort**: L (2-3 days)
**Impact**: Complex projects (SaaS, dashboards) build in minutes not hours

### 3.4 Visual regression testing

After each build, take a screenshot and compare:

```typescript
export async function visualTest(
  sandboxUrl: string,
  expected: 'has-hero' | 'has-nav' | 'has-footer'
): Promise<{ ok: boolean; diff?: Buffer }> {
  // Use Playwright in E2B to screenshot
  const sb = await E2BSandbox.create();
  await sb.commands.run(`npx playwright screenshot ${sandboxUrl} /tmp/shot.png`);
  const screenshot = await sb.files.read('/tmp/shot.png');

  // Use VLM to verify
  const vlmResult = await analyzeWithVLM(screenshot, `Does this page have ${expected}?`);

  return { ok: vlmResult.confirmed };
}
```

**Effort**: L (1-2 days)
**Impact**: Catches "it builds but looks broken" bugs

---

## Phase 4: Distribution (Week 5)

**Goal**: One-click deploy to production.

### 4.1 Vercel deploy

```typescript
// app/routes/api.deploy.vercel.ts
export async function action({ request }: ActionFunctionArgs) {
  const { files, projectId } = await request.json();
  const user = await getAuthedUser(request);

  // 1. Create git commit
  const repo = await createGitHubRepo(user, projectId);
  await pushFiles(repo, files);

  // 2. Trigger Vercel deploy
  const deployment = await vercel.deployments.create({
    projectId: user.vercel_project_id,
    gitSource: { repo: repo.full_name, ref: 'main' }
  });

  return json({ url: deployment.url });
}
```

**Effort**: M (1 day)
**Impact**: Users can ship to production in one click

### 4.2 Netlify deploy (similar to 4.1)

### 4.3 GitHub Pages deploy (similar to 4.1)

---

## Tools & Integrations to Add

### High-impact, low-effort additions:

1. **`web-search` tool** (Tavily API or SerpAPI)
   - LLM can search docs/examples during generation
   - Cost: $0.001/search, free tier available

2. **`screenshot` tool** (Playwright in E2B)
   - LLM can "see" the preview and verify it
   - Cost: $0 (runs in existing E2B sandbox)

3. **`read-url` tool** (fetch + extract)
   - LLM can read documentation URLs
   - Cost: $0

4. **`git-operations` tool** (commit, branch, PR)
   - LLM can version control the project
   - Cost: $0

### Medium-impact additions:

5. **Vector search** (Supabase pgvector)
   - Search across user's previous projects
   - "Build something like my last dashboard" works

6. **Code execution sandbox** (E2B code interpreter)
   - LLM can test snippets before writing them
   - Cost: $0.001/execution

7. **Image generation** (DALL-E/SDXL)
   - Generate assets (logos, illustrations) for the project
   - Cost: $0.04/image

---

## Cost Projection (1000 active users/month)

| Component | Current | After Phase 1-2 | After Phase 3-4 |
|-----------|---------|------------------|------------------|
| Oracle VM | $20-40/mo | $0 (optional) | $0 |
| CF Pages | $0 (free) | $0 (free) | $20 (Pro for higher limits) |
| E2B | $0-25 (1k sandboxes) | $50-100 (snapshots) | $150-300 |
| Supabase | $0-25 | $25 (Pro for realtime) | $25 |
| LLM APIs | user-paid | user-paid | user-paid |
| **Total** | **$45-90** | **$75-125** | **$195-345** |
| **Per user** | $0.045-0.09 | $0.075-0.125 | $0.20-0.35 |

**Note**: With snapshot caching + sandbox reuse, E2B cost stays low even at scale.

---

## Capacity Projection

| Phase | Concurrent users | Build success rate | Avg build time |
|-------|-----------------|-------------------|----------------|
| Current (worker) | 10 | ~60% | 60-180s |
| After Phase 1 | 50 (CF Pages) | ~85% | 30-90s |
| After Phase 2 | 100+ | ~85% | 20-60s |
| After Phase 3 | 100+ | ~95% | 15-45s |
| After Phase 4 | 100+ | ~95% | 15-45s |

---

## Implementation Priority

### Immediate (this week):
1. ✅ Increase `maxLLMSteps` to 15 (1 line)
2. ✅ Add `read_file` + `run_shell` built-in tools (4 hours)
3. ✅ Replace polling with Supabase Realtime (2 hours)

### Next sprint:
4. ⬜ Runtime verification step (6 hours)
5. ⬜ E2B pause/resume instead of destroy (2 hours)
6. ⬜ Snapshot caching for common frameworks (4 hours)

### Quarter 2:
7. ⬜ Model router
8. ⬜ Project context store with vector search
9. ⬜ Parallel sub-agents
10. ⬜ Visual regression testing

### Quarter 3:
11. ⬜ Vercel/Netlify/GitHub Pages deploy
12. ⬜ Vector search across projects
13. ⬜ Image generation integration

---

## Success Metrics

- **Build success rate**: 60% → 95% (Phase 3 target)
- **Concurrent users on free tier**: 10 → 100+ (Phase 2 target)
- **Avg build time**: 120s → 30s (Phase 1 target)
- **Cost per active user**: $0.09 → $0.20 (acceptable for 95% success rate)
- **User retention**: measured via return rate within 7 days
