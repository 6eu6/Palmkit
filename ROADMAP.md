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
