# Palmkit — Roadmap

> تاريخ آخر تحديث: 2026-06-27
>
> الفروع المكتملة موضّحة بـ ✅ والمخططة بـ 🔲

---

## الحالة الراهنة (2026-06-27)

Palmkit هو منصة تطوير AI مبنية على **Remix + Vite + Cloudflare Pages**، مع **Oracle ARM64 worker** خارجي للتوليد، و**Cloudflare R2** لتخزين الملفات، و**WebContainer / E2B** للمعاينة.

**الموقع المنشور**: https://palmkit.app  
**المستودع**: https://github.com/6eu6/Palmkit

---

## المراحل المكتملة

### ✅ Phase 1 — Safety Gate (بوابة الأمان)

**الهدف**: منع preview المكسور يظهر للمستخدم أبداً.

**ما تم تطبيقه**:
- `__PALMKIT_DONE__` completion marker في system prompt
- Output Validator (tags balanced + required files + no placeholders)
- State machine: `generating` → `incomplete_retrying` → `failed_clean` / `ready_for_preview`
- Retry محدود (1-2x فقط) ثم `failed_clean` برسالة واضحة
- `buildStatusStore` + `canShowPreview` computed gate
- Frontend يعرض حالة واضحة في كل وقت

**معايير النجاح — محققة**:
- ✅ preview المكسور لا يظهر أبداً
- ✅ incomplete → retry → `failed_clean` برسالة
- ✅ Frontend يعرض حالة واضحة (مو "Generating Response" فقط)

---

### ✅ Phase 2 — Build Orchestrator (منسق البناء)

**الهدف**: نقل التوليد خارج Cloudflare Pages Function لتجاوز حدود CPU.

**ما تم تطبيقه**:
- External Oracle ARM64 Worker (Bun, `/opt/palmkit-worker`)
- Supabase job queue (`build_jobs` table + `claim_next_build_job()` RPC)
- `generator.ts`: LLM يولّد structured JSON file operations
- Cloudflare R2 لحفظ الملفات المولّدة (S3-compatible API)
- `/api/jobs` CF Pages Function (enqueue + poll + get files)
- `/api/files` endpoint لجلب الملفات من R2
- `previewFilesStore` + `buildStatusStore` في الفرونتند
- Detection ذكي لنوع التطبيق: `static`, `react`, `vue`, `nextjs`, `python`, `flutter`, `react-native`
- `use-external-worker` hook: polling + annotation handling
- Preview gate: static → blob URL مباشرة، غير static → Phase 3

**أنواع التطبيقات المدعومة في Worker**:
| النوع | System Prompt | ملفات مولّدة |
|-------|--------------|-------------|
| `static` | HTML/CSS/JS خالص | index.html, style.css, script.js |
| `react` | Vite + React + TypeScript | package.json, src/App.tsx, ... |
| `vue` | Vite + Vue 3 + TypeScript | package.json, src/App.vue, ... |
| `nextjs` | Next.js 14 App Router | package.json, app/page.tsx, ... |
| `python` | FastAPI / Flask | main.py, requirements.txt, ... |
| `flutter` | Flutter + Dart Material 3 | pubspec.yaml, lib/main.dart, ... |
| `react-native` | Expo + TypeScript | package.json, App.tsx, ... |

**معايير النجاح — محققة**:
- ✅ مشروع كامل يُبنى على Oracle Worker في < 90 ثانية
- ✅ انقطاع المتصفح لا يكسر الـ job (Worker مستقل)
- ✅ CF Pages Function = API خفيف فقط (لا توليد)
- ✅ الملفات في R2 + manifest في Supabase

---

### ✅ Phase 3 — Sandbox Execution (تشغيل في Sandbox)

**الهدف**: تشغيل مشاريع React/Vue/Next.js/Python في بيئة فعلية بدون تكلفة E2B على الديسكتوب.

**التوجيه الذكي (Smart Routing)**:

| النوع + الجهاز | المعاينة | التكلفة |
|---------------|---------|---------|
| `static` (أي جهاز) | Blob URL مباشر | مجاني |
| `react/vue/nextjs` + ديسكتوب | WebContainer (in-browser WASM) | مجاني |
| `react/vue/nextjs` + جوال | E2B cloud sandbox | ~$0.0002/CPU-ثانية |
| `python` (أي جهاز) | E2B cloud sandbox | ~$0.0002/CPU-ثانية |
| `flutter/react-native` | تعليمات تشغيل محلي | مجاني |

**ما تم تطبيقه**:
- `app/lib/hooks/use-worker-sandbox.ts`: bridge hook يربط R2 files بـ WebContainer/E2B
- WebContainer: يكتب الملفات إلى `/home/project/preview/`، يشغّل `npm install`، ثم `npm run dev`
- Auto-launch على الديسكتوب (WebContainer مجاني)
- زر "Launch Cloud Preview" على الجوال (E2B — يحتاج موافقة المستخدم لتجنب تكاليف عشوائية)
- Progress states في الفرونتند: Writing → Installing → Starting → Ready
- "Try Again" عند الخطأ

**معايير النجاح — محققة**:
- ✅ مشاريع React تعمل في WebContainer على الديسكتوب (مجاني)
- ✅ الجوال يحتاج موافقة صريحة للـ E2B
- ✅ Python/Flask يعمل عبر E2B
- ✅ Flutter/React Native تعرض تعليمات واضحة

---

## المراحل المخططة

### 🔲 Phase 4 — Build Verification + Auto-Repair

**الهدف**: صفر أخطاء TypeScript في مشاريع React/Vue/Next.js تصل للمستخدم.

**المشكلة**: حالياً، Oracle Worker يولّد الكود ويحفظه دون التحقق من نجاح `npm run build`. قد يكون الكود يعمل في WebContainer لكن فيه أخطاء TypeScript أو missing imports.

**الخطة**:

1. **Build Check في Oracle Worker**
   - بعد توليد الملفات، Worker يشغّل `npm run build` / `tsc --noEmit` في E2B sandbox
   - لو نجح → `ready_for_preview`
   - لو فشل → Phase 2: Repair Pass

2. **Repair Agent (Pass 1)**
   - يأخذ: build errors + الملفات المتأثرة فقط
   - يرسل LLM call بصيغة patch: `{"op":"patch","path":"src/App.tsx","content":"..."}`
   - يعيد البناء مرة أخرى

3. **Repair Pass 2 (إذا لزم)**
   - نفس العملية، max 2 passes
   - لو فشل بعد pass 2 → `failed_clean` مع رسالة "Build errors — download to fix"

4. **تحديثات الـ Generator**
   - Oracle Worker: أضف `build_check` step في `job-processor.ts`
   - E2B integration في Worker (server-side, مو في المتصفح)

**ملفات المتأثرة**:
- `external-worker/src/job-processor.ts` — أضف build check step
- `external-worker/src/build-runner.ts` — E2BRunner حقيقي (بدل StaticRunner)
- `external-worker/src/generator.ts` — أضف repair mode

**معايير النجاح**:
- [ ] مشروع React يُبنى بدون TypeScript errors ≥ 90% من الوقت
- [ ] Build errors تُصلح تلقائياً دون تدخل المستخدم
- [ ] Worker job ينتهي بـ `ready_for_preview` أو `failed_clean` واضح

---

### 🔲 Phase 5 — SSE Progress Stream (تدفق مباشر)

**الهدف**: المستخدم يرى خطوة بخطوة ماذا يبني Palmkit بدل انتظار صامت.

**المشكلة الحالية**: الفرونتند يـ poll `/api/jobs/:id` كل 2 ثانية — لا توجد رسائل تقدم حقيقية للمستخدم أثناء البناء.

**الخطة**:

1. **Oracle Worker يكتب progress events في Supabase**
   ```
   { job_id, step: "planning", message: "Analyzing requirements..." }
   { job_id, step: "writing", file: "package.json", count: 1, total: 8 }
   { job_id, step: "writing", file: "src/App.tsx", count: 2, total: 8 }
   { job_id, step: "build_check", message: "Running npm build..." }
   { job_id, step: "done", message: "Ready!" }
   ```

2. **SSE Endpoint `/api/jobs/:id/events`**
   - CF Pages Function يقرأ من Supabase Realtime أو يـ poll
   - يرسل server-sent events للفرونتند

3. **Frontend Progress UI**
   ```
   🔨 Building your React app
   ✓ Planning app structure
   ✓ Writing package.json (1/8)
   ✓ Writing src/App.tsx (2/8)
   ⏳ Writing src/components/... (3/8)
   ○ Running build check
   ○ Preparing preview
   ```

**ملفات المتأثرة**:
- `external-worker/src/job-processor.ts` — emit progress events
- `app/routes/api.jobs.ts` — أضف `/events` SSE sub-route
- `app/lib/hooks/use-external-worker.ts` — استخدم SSE بدل polling
- `app/components/chat/` — progress UI component

**معايير النجاح**:
- [ ] المستخدم يرى progress حقيقي خطوة بخطوة
- [ ] لا انتظار صامت > 3 ثواني دون رسالة
- [ ] انقطاع SSE → تراجع تلقائي لـ polling

---

### 🔲 Phase 6 — Project History & Persistence

**الهدف**: المستخدم يحفظ مشاريعه ويعود إليها لاحقاً.

**المشكلة الحالية**: كل محادثة مؤقتة — إغلاق المتصفح = فقدان المشروع.

**الخطة**:

1. **Project Model في Supabase**
   ```sql
   CREATE TABLE projects (
     id UUID PRIMARY KEY,
     user_id UUID REFERENCES auth.users,
     name TEXT,
     description TEXT,
     app_type TEXT,
     r2_prefix TEXT,  -- path في R2 لملفات المشروع
     created_at TIMESTAMPTZ,
     updated_at TIMESTAMPTZ
   );
   ```

2. **Auto-Save بعد `ready_for_preview`**
   - Oracle Worker يحفظ metadata المشروع في `projects` table
   - R2 files تبقى محفوظة تحت `projects/{project_id}/`

3. **My Projects Page**
   - صفحة `/projects` تعرض مشاريع المستخدم
   - كل مشروع: اسم، وصف، تاريخ، نوع التطبيق، زر "Open"
   - فتح مشروع → يُحمّل ملفاته من R2 → preview جاهز

4. **Export Project**
   - زر "Export ZIP" يعمل للملفات من R2 (حالياً يعمل للـ WebContainer فقط)

**ملفات المتأثرة**:
- `supabase/migrations/` — migration للـ projects table
- `app/routes/api.projects.ts` — CRUD API
- `app/routes/projects.tsx` — Projects page
- `external-worker/src/job-processor.ts` — save project on complete

**معايير النجاح**:
- [ ] مشروع يُحفظ تلقائياً بعد اكتمال البناء
- [ ] المستخدم يرى قائمة مشاريعه
- [ ] Re-open مشروع → preview جاهز في < 5 ثواني

---

### 🔲 Phase 7 — Multi-turn Edit (التعديل التراكمي)

**الهدف**: بعد البناء الأول، التعديلات تُطبَّق بشكل ذكي دون إعادة بناء كامل.

**المشكلة الحالية**: كل رسالة = build job جديد كامل = وقت + تكلفة.

**الخطة**:

1. **Mode Detection**
   - إذا `project_id` موجود في context → "edit mode"
   - Edit mode → LLM يولّد patch operations فقط (مو full project)

2. **Patch Operations Format**
   ```json
   [
     {"op": "patch", "path": "src/App.tsx", "content": "..."},
     {"op": "write", "path": "src/components/NewComp.tsx", "content": "..."},
     {"op": "delete", "path": "src/old.ts"}
   ]
   ```

3. **Diff View**
   - الفرونتند يعرض ماذا تغيّر (مثل GitHub diff)
   - المستخدم يقبل أو يرفض التغييرات

4. **Smart Context**
   - LLM يرى: الطلب الجديد + ملخص المشروع + الملفات المتأثرة فقط
   - يوفر tokens ويقلل وقت البناء

**ملفات المتأثرة**:
- `external-worker/src/generator.ts` — edit mode system prompt
- `external-worker/src/job-processor.ts` — patch operations handler
- `app/routes/api.jobs.ts` — أضف `project_id` parameter
- `app/components/workbench/` — diff view UI

**معايير النجاح**:
- [ ] تعديل بسيط (تغيير لون) ينتهي في < 15 ثانية
- [ ] الملفات غير المتأثرة لا تُعاد كتابتها
- [ ] Diff view يعرض التغييرات بوضوح

---

### 🔲 Phase 8 — Native App Delivery

**الهدف**: دعم كامل لـ Flutter و React Native وليس فقط "download and run".

**المخطط**:

1. **Flutter Web Preview**
   - Oracle Worker يشغّل `flutter build web` في E2B sandbox
   - Output يُرفع لـ R2 كـ static files
   - Preview يظهر في المتصفح مثل static app

2. **React Native / Expo**
   - Oracle Worker يشغّل `expo export -p web`
   - Web output → R2 → blob URL preview
   - أو: Expo Snack integration (embed مباشر)

3. **Python Backend**
   - E2B sandbox يبقى حياً لمدة أطول (مو 7 دقائق فقط)
   - URL دائم للـ API (مو مؤقت)
   - دعم WebSockets

**معايير النجاح**:
- [ ] Flutter web app تُعاين في المتصفح مباشرة
- [ ] React Native/Expo تُعاين عبر web build
- [ ] Python API يبقى متاحاً لمدة المحادثة

---

## سجل الـ Commits

| التاريخ | الوصف |
|---------|-------|
| 2026-06-27 | feat(phase3): WebContainer + E2B sandbox bridge |
| 2026-06-27 | feat: Flutter/React Native + dynamic models (xAI, Mistral) |
| 2026-06-27 | feat: Oracle worker deployed on ARM64, Phase 2 end-to-end |
| 2026-06-26 | fix: Phase 2 appType gate, blob preview, truncated JSON |
| 2026-06-26 | feat: External worker + R2 + Supabase job queue |
| 2026-06-25 | feat: Phase 1 Safety Gate (completion marker + validator) |
| 2026-06-23 | feat: initial Oracle worker scaffold |

---

## القيود والملاحظات التقنية

| المورد | الحد | ملاحظة |
|--------|------|--------|
| Cloudflare Pages (Free) | 10ms CPU/invocation | الـ I/O لا يُحسب، streaming مسموح |
| Oracle Worker | 4 ARM cores, 24 GB RAM | لا حدود CPU، اللجنة بحجم الـ LLM response |
| Cloudflare R2 | 10 GB storage, egress مجاني | مثالي لتخزين الملفات المولّدة |
| WebContainer | مجاني للجميع | يحتاج COOP/COEP headers (مُضافة في `entry.server.tsx`) |
| E2B | ~$0.000225/CPU-ثانية | يُستخدم فقط للجوال أو Python |
| Supabase (Free) | 500 MB DB, 1 GB storage | كافٍ للـ metadata والـ jobs queue |
