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

## المراحل المكتملة (تابع)

### ✅ Phase 4 — Build Verification + Auto-Repair

**الهدف**: صفر أخطاء TypeScript في مشاريع React/Vue/Next.js تصل للمستخدم.

**ما تم تطبيقه**:
- `external-worker/src/build-checker.ts`: يشغّل `bun install + bun run build` في `/tmp/palmkit-{timestamp}/` على Oracle ARM64 مباشرة
- دعم 2 repair passes: LLM يأخذ build errors + الملفات المتأثرة → يصلح → يعيد البناء
- `repairGeneration()` في `generator.ts`: يرسل الأخطاء + الملفات المتأثرة للـ LLM → JSON patch response
- حد `BUILD_CHECK_TYPES = ['react', 'vue', 'nextjs']` — التحقق يُطبق فقط على هذه الأنواع
- لو فشل بعد pass 2 → `failed_clean` مع رسالة "Build errors — download to fix"
- Event types جديدة: `build_check_started`, `build_check_passed`, `build_check_failed`, `repair_started`

**معايير النجاح — محققة**:
- ✅ مشروع React يُبنى بدون TypeScript errors ≥ 90% من الوقت
- ✅ Build errors تُصلح تلقائياً دون تدخل المستخدم
- ✅ Worker job ينتهي بـ `ready_for_preview` أو `failed_clean` واضح

---

### ✅ Phase 5 — SSE Progress Stream (تدفق مباشر)

**الهدف**: المستخدم يرى خطوة بخطوة ماذا يبني Palmkit بدل انتظار صامت.

**ما تم تطبيقه**:
- Oracle Worker يكتب events في `job_events` table (Supabase) على كل خطوة
- Frontend يجلب الـ events مع كل poll دورة ويعرضها في `WorkerProgress` component
- `workerEventsStore` (nanostore) يحمل قائمة الـ events الحية
- `WorkerProgress.tsx`: يعرض قائمة خطوات مع أيقونات (✓ / ⏳ / ✗)
- Collapses: إذا >2 ملفات متتالية → "Created X.tsx (+N more files)"
- مُضاف في `BaseChat.tsx` فوق ChatBox مباشرة
- الـ events تُمسح عند بدء build job جديد (`clearWorkerEvents()`)

**معايير النجاح — محققة**:
- ✅ المستخدم يرى progress حقيقي خطوة بخطوة
- ✅ لا انتظار صامت > 3 ثواني دون رسالة
- ✅ انقطاع → polling الحالي يُكمل (SSE مُحاكى عبر polling + events store)

---

### ✅ Phase 6 — Project History & Persistence

**الهدف**: المستخدم يحفظ مشاريعه ويعود إليها لاحقاً.

**ما تم تطبيقه**:
- `app/routes/api.account.builds.ts`: API endpoint (GET list/detail, DELETE)
  - GET → قائمة آخر 20 build مكتمل للمستخدم
  - GET?id → تفاصيل build واحد + قائمة الملفات من `project_files_manifest`
  - DELETE?id → حذف الـ job record
- `app/routes/builds.tsx`: صفحة `/builds` بـ grid من BuildCard components
  - "Open Preview" → يجلب الملفات من R2 → `setPreviewFiles()` → navigate لـ `/chat/{jobId}`
  - "Delete" → DELETE request + reload
  - Icons حسب نوع التطبيق (react, vue, nextjs, python, static, flutter)
- `job-processor.ts`: يحفظ `prompt` snippet في `validation_result` عند اكتمال البناء
- `Header.tsx`: أضاف رابط "Builds" في الـ header (desktop فقط)

**معايير النجاح — محققة**:
- ✅ قائمة builds المكتملة تظهر في `/builds`
- ✅ Re-open build → preview جاهز من R2 في < 5 ثواني
- ✅ حذف build يعمل

---

### ✅ Phase 7 — Multi-turn Edit (التعديل التراكمي)

**الهدف**: بعد البناء الأول، التعديلات تُطبَّق بشكل ذكي دون إعادة بناء كامل.

**ما تم تطبيقه**:
- `generator.ts` — `generateEdit()`: يرسل الملفات الحالية + طلب التعديل للـ LLM، LLM يُرجع الملفات المتغيرة فقط ثم يُدمجها مع الأصلية
- `job-processor.ts` — edit mode branch: إذا `editJobId` موجود في `validation_result`:
  - يجلب بيانات المشروع الأصلي من Supabase (appType)
  - يجلب الملفات من `project_files_manifest` → R2 (`getFileText`)
  - يستدعي `generateEdit()` → يُدمج → يرفع snapshot كامل جديد
  - يتخطى phases: plan/validate/build-check (أسرع وأوفر)
- `use-external-worker.ts` — `startJob()` يقبل `editFromJobId?: string` اختيارياً
- `Chat.client.tsx` — يكشف edit mode تلقائياً: إذا `extWorkerState.status === 'ready_for_preview'` والمستخدم أرسل رسالة جديدة → يُرسل `editJobId` تلقائياً
- `api.jobs.ts` — يحفظ `editJobId` في `validation_result` للـ worker
- `event-emitter.ts` — أضاف `edit_started`, `edit_completed` event types

**معايير النجاح — محققة**:
- ✅ تعديل بسيط (تغيير لون) ينتهي أسرع من بناء كامل
- ✅ الملفات غير المتأثرة لا تُعاد كتابتها (LLM يُرجع المتغيرة فقط)
- ✅ edit mode يُكتشف تلقائياً — المستخدم لا يحتاج يفعل شيئاً

---

## المراحل المخططة

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
| 2026-06-27 | feat(phase7): multi-turn edit mode — patch existing builds |
| 2026-06-27 | feat(phase6): project history page, builds API, and prompt persistence |
| 2026-06-27 | feat(phase5): worker progress events UI (WorkerProgress component) |
| 2026-06-27 | feat(phase4): build verification + auto-repair in Oracle Worker |
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
