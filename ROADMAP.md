# Palmkit Roadmap

> سجل كامل لكل تقنية ناقشناها، وما طبقناه (✓) وما لم نطبقه بعد (○)، مع خطة التنفيذ المرحلية.
>
> آخر تحديث: Phase 1 — Safety Gate (قيد التنفيذ)

---

## 1. ملخص الحالة الراهنة

Palmkit هو fork من Bolt.diy (open source) مبني على **Remix + Vite + Cloudflare Pages**، يستخدم **OpenRouter** كـ provider أساسي و **Supabase** للمصادقة + تخزين المشاريع، و **WebContainer / E2B** لمعاينة الكود.

الموقع المنشور: **https://palmkit.app** (Cloudflare Pages، project = `mobile-ai-dev-workspace`).
المستودع: **https://github.com/6eu6/Palmkit**.

### المشكلة الجذرية المشخّصة (بعد اختبار فعلي على الموقع)

Palmkit يعتمد على **طلب Cloudflare Pages Function واحد طويل** يبني المشروع كامل في stream واحد:

```
User prompt
  → CF Pages Function (api.chat.ts)
  → OpenRouter streaming
  → HTML/artifact طويل كامل
  → parser → file writer → preview
```

هذا التصميم **هش بنيوياً**:
- Cloudflare Pages Functions تعمل على Workers runtime، Free plan = **10ms CPU** per invocation (الـ I/O streaming لا يحسب، لكن الـ CPU time محدود).
- أي مشروع أكبر من coffee shop بسيط → الـ stream ينقطع → ملفات ناقصة → preview مكسور.
- المستخدم يضطر يكتب "استمر" — وهذا فشل لتجربة vibe coding.

**الاختبار الفعلي** (بـ DeepSeek V3.1 على palmkit.app):
- قبل الإصلاحات: 0/3 ملفات تُنشأ، preview فاضي.
- بعد إصلاحات الـ prompt: 2/3 ملفات (index.html 186 سطر + styles.css 502 سطر)، لكن `script.js` فاضي (budget نفاذ).
- preview شغّال لكن المشروع ناقص — هذا **غير مقبول** كمنتج.

---

## 2. سجل التقنيات (Techniques Ledger)

### 2.1 تقنيات System Prompt (مُطبّقة ✓)

| # | التقنية | الالتزام | ملاحظات |
|---|---------|---------|---------|
| 1 | **File Completeness Rules** (7 قواعد صارمة) | ✓ commit `fecbba4` | منع ملفات فاضية + placeholders |
| 2 | **Mobile-First Design** (390px, 44px touch, no hover) | ✓ commit `fecbba4` | Palmkit mobile-first platform |
| 3 | **Framework Guidance** (decision tree: vanilla/framework/python) | ✓ commit `fecbba4` | يختار الـ stack الصحيح |
| 4 | **Design Standards** ("make it look like a real product") | ✓ commit `fecbba4` | typography, depth, micro-interactions |
| 5 | **Adaptive Intelligence** (DISCUSS/PLAN/BUILD/CLARIFY) | ✓ commit `fecbba4` | يكيّف السلوك حسب الرسالة |
| 6 | **Artifact Format Rules** (12 قاعدة) | ✓ commit `fecbba4` | structure + ordering |
| 7 | **CL4R1T4S: Tone & Formatting** | ✓ commit `6cf83fd` | لا تبالغ في bullets/bold، طابق طاقة المستخدم |
| 8 | **CL4R1T4S: Intellectual Honesty** | ✓ commit `6cf83fd` | اعرض trade-offs من الجانبين، قل "ما أدري" |
| 9 | **CL4R1T4S: Owns Mistakes** | ✓ commit `6cf83fd` | اعترف بالخطأ مباشرة وصلحه |
| 10 | **MANDATORY Artifact Enforcement** | ✓ commit `57b848f` | "NO EXCEPTIONS — files will NOT be created without tags" |
| 11 | **Complete HTML/CSS/JS Example** (بدل placeholders) | ✓ commit `57b848f` | مثال كامل حقيقي |
| 12 | **Static vs Framework Decision Tree** | ✓ commit `57b848f` | vanilla ≠ npm install |
| 13 | **TOKEN BUDGET section** | ✓ commit `a317212` | ⚠️ **band-aid — سيُحذف في Phase 1** |
| 14 | **Slime coffee-shop example** (220→50 سطر) | ✓ commit `f368fab` | توفير ~1500 token |

### 2.2 تقنيات Build Orchestration (غير مُطبّقة ○)

| # | التقنية | الالتزام | المرحلة |
|---|---------|---------|---------|
| 15 | **`__PALMKIT_DONE__` completion marker** | ○ | Phase 1 |
| 16 | **Output Validator** (tags balanced, required files, no placeholders) | ○ | Phase 1 |
| 17 | **Status State Machine** (`generating` / `incomplete_retrying` / `failed_clean` / `ready_for_preview`) | ○ | Phase 1 |
| 18 | **Retry محدود** (1-2x فقط لـ incomplete، مو garbage) | ○ | Phase 1 |
| 19 | **`build_jobs` table** (id, project_id, status, current_step, progress, error_summary) | ○ | Phase 1 |
| 20 | **`build_steps` table** (id, job_id, type, status, input_summary, output_summary, error) | ○ | Phase 1 |
| 21 | **`project_files_manifest` table** (path, hash, size, version, storage_provider, storage_key) — metadata فقط | ○ | Phase 1 |
| 22 | **Browser storage للملفات** (IndexedDB/OPFS/local state — مو Supabase) | ○ | Phase 1 |
| 23 | **BuildRunner Interface** (abstraction قابل للاستبدال في Phase 2) | ○ | Phase 1 |
| 24 | **Frontend Status UI** (حالات واضحة، no broken preview) | ○ | Phase 1 |
| 25 | **Hard stop بعد retry محدود** (مو infinite loop داخل CF) | ○ | Phase 1 |
| 26 | **External Build Worker** (Cloudflare Workflows أو Render/Railway) | ○ | Phase 2 |
| 27 | **File Operations JSON** (بدل HTML خام طويل) | ○ | Phase 2 |
| 28 | **Build Orchestrator Loop** (plan → file_tree → generate_files → validate → repair → ready) | ○ | Phase 2 |
| 29 | **SSE endpoint للـ progress** (`GET /api/jobs/:id/events`) | ○ | Phase 2 |
| 30 | **Cloudflare R2 للـ snapshots** (10GB free، egress مجاني) | ○ | Phase 2 |
| 31 | **Real build runner** (`npm run build` / `tsc --noEmit` فعلي) | ○ | Phase 3 |
| 32 | **Repair Agent** (error + affected files → patch only) | ○ | Phase 3 |
| 33 | **Patch Operations** للتغييرات (لا إعادة بناء كامل) | ○ | Phase 3 |
| 34 | **Ready-for-Preview Gate** (validation قبل فتح preview) | ○ | Phase 3 |
| 35 | **Requirement Extraction** (من 1000 سطر وصف → project_spec.json) | ○ | Phase 3 |

### 2.3 إصلاحات Infra (غير مُطبّقة ○)

| # | التقنية | الالتزام | المرحلة |
|---|---------|---------|---------|
| 36 | **نقل generation خارج CF Pages Function** | ○ | Phase 2 |
| 37 | **Cloudflare Workflows** (durable multi-step) | ○ | Phase 2 (قرار) |
| 38 | **External Worker** (Render/Railway/Oracle) — أقل lock-in | ○ | Phase 2 (قرار) |
| 39 | **WebContainer للـ React/Vite preview** | ○ | Phase 3+ |

---

## 3. خطة التنفيذ المرحلية

### Phase 1 — Safety Gate (الحماية الفورية) ✅ مكتمل ومُختبر

**النتائج الفعلية على palmkit.app** (3 سيناريوهات):

| السيناريو | النتيجة | الحالة |
|-----------|---------|--------|
| Coffee shop (متوسط) | "Build incomplete — stream was interrupted" | ✅ رسالة واضحة، لا preview مكسور |
| Ecommerce معقد (قطع إجباري) | "Build incomplete" + "No preview available" | ✅ فشل نظيف بدون preview |
| Hello world بسيط (نجاح) | "Build complete — ready for preview" + preview أحمر | ✅ نجح بعد auto-retry (AI نسي الماركر أول مرة) |

**الهدف**: منع preview المكسور يظهر للمستخدم أبداً. **ليس** حل التوليد الطويل — هذا Phase 2.

**القيود الصارمة** (متفق عليها):
- ✅ retry محدود (1-2x) فقط، **لا** infinite loop داخل CF Pages Function
- ✅ Supabase = metadata فقط (jobs/steps/manifest)، **لا** file content
- ✅ الملفات في browser storage (IndexedDB/local state)
- ✅ لا تعرض preview إلا بعد validation نجح
- ✅ **احذف** TOKEN BUDGET (band-aid، يقلل الجودة)
- ✅ جهّز `BuildRunner` interface لـ Phase 2

**خطوات التنفيذ**:
1. DB migration `0006_build_jobs.sql`: `build_jobs` + `build_steps` + `project_files_manifest`
2. عدّل `prompts.ts`: أضف `__PALMKIT_DONE__`، احذف `<token_budget>`
3. عدّل `enhanced-message-parser.ts`: Output Validator (tags balanced + required files + no placeholders)
4. عدّل `api.chat.ts`: status tracking + retry محدود (1-2x) + hard stop
5. أضف `BuildRunner` interface (abstraction layer)
6. عدّل frontend: حالات `generating` / `incomplete_retrying` / `failed_clean` / `ready_for_preview`
7. اختبر 3 سيناريوهات على live

**سيناريوهات الاختبار**:
- ✅ Coffee shop عادي → لازم يكتمل أو يعرض "Still building"
- ✅ قطع stream متعمد في منتصف `<palmkitAction>` → لازم يرفض preview، يعيد retry، ثم `failed_clean`
- ✅ مشروع أطول (ecommerce landing + cart + admin mock) → لازم يكتمل أو يفشل برسالة واضحة

**النجاح =** preview المكسور لا يظهر أبداً.

---

### Phase 2 — Build Orchestrator (الفصل المعماري) 🚧 scaffold مكتمل

**ما تم**:
- ✅ External Worker scaffold (`external-worker/` مشروع Bun مستقل)
- ✅ R2 client (S3-compatible) + Supabase Storage bucket `palmkit-files`
- ✅ `claim_next_build_job()` RPC (atomic, multi-worker safe)
- ✅ `/api/jobs` thin API على CF Pages (enqueue + status)
- ✅ Migration 0007 (pending status + RPC + bucket)

**ما تبقّى**:
- ○ نقل logic التوليد من `api.chat.ts` إلى `job-processor.ts` (phases: plan/generate/validate/repair)
- ○ SSE endpoint للـ progress الحقيقي
- ○ Frontend polling لـ `/api/jobs/:id` + عرض progress حقيقي
- ○ اختبار end-to-end: enqueue → worker → R2 → preview

**الهدف**: Palmkit يبني مشاريع كبيرة بدون ما يكسر.

**القرار المعلّق**: Cloudflare Workflows (lock-in، أبسط) vs External Worker على Render/Railway (أقل lock-in، تعقيد infra أعلى).

**القرار المتخذ**: ✅ External Worker + R2 (أقل lock-in، تحكم كامل).

**المخطط**:
1. External worker يستلم job من queue (Supabase)
2. Worker يولّد `project_spec.json` (requirement extraction)
3. Worker يولّد file tree
4. لكل ملف: AI call مستقل بصيغة `{"op":"write_file","path":"...","content":"..."}`
5. كل ملف يُحفظ فوراً في R2 + manifest في Supabase
6. بعد كل batch: validation
7. لو فشل: repair pass (error + affected files only)
8. عند النجاح: `status = ready_for_preview` + SSE notification للـ frontend

**الـ Frontend** يعرض:
```
Building your ecommerce app
✓ Planning app structure
✓ Creating database schema
✓ Building product catalog
⏳ Generating checkout page
○ Running build checks
○ Preparing preview
```

---

### Phase 3 — Repair Loop + Patches (الجودة العالية) ○

**الهدف**: vibe coding حقيقي — المستخدم يطلب، النظام يبني ويفحص ويصلح تلقائياً.

**المخطط**:
1. **Real Build Runner**: شغّل `npm run build` / `tsc --noEmit` فعلياً في sandbox (E2B)
2. **Repair Agent**: لو build فشل، أرسل error + الملفات المتأثرة فقط → AI يرجع patch operations
3. **Patch Operations**: للتغييرات، حدد الملفات المتأثرة و patch فقط (لا إعادة بناء كامل)
4. **Ready-for-Preview Gate**: ما تفتح preview إلا بعد:
   - ✓ كل `<palmkitArtifact>` مغلقة
   - ✓ الملفات الأساسية موجودة
   - ✓ `npm run build` ينجح
   - ✓ لا placeholders/TODO
   - ✓ imports مكسورة = صفر

---

## 4. السجل الزمني للـ Commits

| التاريخ | Commit | الوصف |
|---------|--------|-------|
| 2026-06-23 | `27bce25` | feat(preview): Project Analyzer + Static iframe preview |
| 2026-06-23 | `35f385a` | fix(preview): handle runtime transitions (static ↔ E2B) |
| 2026-06-23 | `a5c0b15` | feat(runtime): multi-framework support — Express, Next.js, Python |
| 2026-06-23 | `9e96978` | feat(cache): E2B snapshot cache — npm install 15s → 2-3s |
| 2026-06-23 | `46df4f2` | feat(deploy): internal hosting — deploy apps to /p/{slug} |
| 2026-06-23 | `fecbba4` | ✓ feat(prompt): rewrite system prompt — completeness + mobile-first |
| 2026-06-23 | `6cf83fd` | ✓ feat(prompt): CL4R1T4S techniques — tone + honesty + owns mistakes |
| 2026-06-23 | `57b848f` | ✓ fix(prompt): MANDATORY artifact format + complete HTML/CSS/JS example |
| 2026-06-23 | `f368fab` | ✓ perf(prompt): shrink coffee-shop example — save ~1500 tokens |
| 2026-06-23 | `a317212` | ⚠️ feat(prompt): TOKEN BUDGET (band-aid — سيُحذف في Phase 1) |
| قيد التنفيذ | — | Phase 1 — Safety Gate |

---

## 5. القيود البيئية المعروفة

1. **Sandbox الحالي لا يشغّل Palmkit محلياً**: `/home/z/palmkit-work` بدون `node_modules` (مشروع Remix+Electron ضخم). التعديلات تُختبر على `palmkit.app` بعد CF build.
2. **Cloudflare Pages Free**: 10ms CPU/invocation، streaming مسموح لكن CPU محدود.
3. **OpenRouter**: مفتاح مرتبط بالحساب (server-side)، لا في localStorage.
4. **Supabase**: migrations نظام واضح (`0001_` → `0005_`)، التالي `0006_`.

---

## 6. معايير النجاح

### Phase 1 (Safety Gate) نجح إذا:
- [ ] preview المكسور لا يظهر أبداً للمستخدم
- [ ] أي incomplete → retry 1-2x → `failed_clean` برسالة واضحة
- [ ] DB يحفظ job status + step status + file manifest
- [ ] Frontend يعرض حالة واضحة (مو "Generating Response" أبداً)
- [ ] TOKEN BUDGET محذوف (الجودة رجعت)
- [ ] 3 سيناريوهات الاختبار كلها نجحت

### Phase 2 نجح إذا:
- [ ] مشروع ecommerce كامل (10+ ملفات) يُبنى بدون انقطاع
- [ ] انقطاع المتصفح لا يكسر الـ job
- [ ] Frontend يعرض progress حقيقي خطوة بخطوة
- [ ] CF Pages Function = API خفيف فقط

### Phase 3 نجح إذا:
- [ ] `npm run build` يشتغل فعلياً في sandbox
- [ ] build errors تُصلح تلقائياً (repair agent)
- [ ] تعديل المستخدم = patch فقط (مو إعادة بناء)
- [ ] Ready-for-Preview Gate يمنع كل preview غير صالح
