# Palmkit — هيكل المشروع (Project Structure)

> **آخر تحديث**: 2026-07-21 (بعد اكتمال P0–P5 cleanup)
> **الغرض**: خريطة شاملة لمجلدات وملفات المشروع لتسهيل التنقل والصيانة.

---

## البنية الكاملة

```
Palmkit/
├── app/                          # الكود المصدري للواجهة (Remix + Vite)
│   ├── components/               # مكوّنات React
│   │   ├── @settings/           # إعدادات التطبيق (tabs متعددة)
│   │   │   ├── core/             # الأنواع والإعدادات الأساسية
│   │   │   ├── shared/           # مكوّنات مشتركة بين التبويبات
│   │   │   ├── tabs/             # تبويبات الإعدادات
│   │   │   │   ├── data/          # تبويب البيانات
│   │   │   │   ├── event-logs/    # سجل الأحداث
│   │   │   │   ├── github/        # تكامل GitHub
│   │   │   │   ├── gitlab/        # تكامل GitLab
│   │   │   │   ├── netlify/       # تكامل Netlify
│   │   │   │   ├── providers/     # مزودي LLM (cloud/local)
│   │   │   │   ├── supabase/      # تكامل Supabase
│   │   │   │   └── vercel/        # تكامل Vercel
│   │   │   └── utils/            # أدوات مساعدة
│   │   ├── chat/                 # واجهة المحادثة
│   │   │   ├── build-stream/     # (P4) utilities مستخرجة من BuildStream
│   │   │   ├── chatExportAndImport/  # تصدير/استيراد المحادثات
│   │   │   └── *.tsx             # BuildStream, Chat, ModelSelector, إلخ
│   │   ├── deploy/               # مكوّنات النشر
│   │   ├── editor/                # محرر الكود
│   │   ├── header/                # الترويسة
│   │   ├── landing/               # صفحة الهبوط
│   │   ├── mobile/                # واجهة الجوال
│   │   ├── sandbox/                # مكوّنات Sandbox
│   │   ├── sidebar/                # الشريط الجانبي
│   │   ├── ui/                     # مكوّنات UI أساسية (shadcn/ui)
│   │   │   └── workspace/          # مكوّنات مساحة العمل
│   │   └── workbench/              # مساحة العمل (Preview, Editor, Terminal)
│   │       └── terminal/           # محاكي Terminal
│   ├── lib/                        # مكتبات ومنطق الأعمال
│   │   ├── api/                    # وكلاء API
│   │   ├── auth/                   # المصادقة (Supabase)
│   │   ├── chat/                   # أدوات المحادثة
│   │   ├── common/                 # مشترك
│   │   │   └── prompts/            # قوالب الـ prompts للـ LLM
│   │   ├── hooks/                  # React hooks
│   │   ├── modules/                # وحدات منطقية
│   │   ├── persistence/            # التخزين المحلي (IndexedDB)
│   │   │   ├── chat-history/       # (P4) utilities مستخرجة من useChatHistory
│   │   │   └── *.ts               # db, accountSync, types
│   │   ├── runtime/                # runtime helpers
│   │   ├── sandbox/                # sandbox helpers
│   │   ├── security.ts             # أمان
│   │   ├── services/               # خدمات (importExport, gitlabApi)
│   │   ├── stores/                  # nanostores (state management)
│   │   │   └── build-status.ts     # حالة البناء + preview
│   │   ├── types/                  # أنواع TypeScript
│   │   ├── utils/                  # أدوات مساعدة
│   │   └── webcontainer/           # WebContainer API (shim)
│   ├── routes/                     # Remix routes (API + pages)
│   │   ├── _index.tsx              # الصفحة الرئيسية
│   │   ├── api.*.ts                # API endpoints (63 route)
│   │   └── chat.$chatId.tsx        # صفحة المحادثة
│   ├── styles/                     # SCSS + CSS
│   │   ├── components/             # أنماط المكوّنات
│   │   ├── variables.scss          # متغيرات الثيم (20KB)
│   │   ├── landing.scss            # أنماط صفحة الهبوط
│   │   └── mobile.scss             # أنماط الجوال
│   ├── types/                      # أنواع TypeScript مشتركة
│   ├── utils/                      # أدوات مساعدة
│   ├── entry.client.tsx           # نقطة دخول العميل
│   ├── entry.server.tsx           # نقطة دخول الخادم
│   ├── root.tsx                   # جذر التطبيق
│   └── vite-env.d.ts              # تعريفات Vite
├── external-worker/                # الوركر الخارجي (Bun على Oracle)
│   ├── src/
│   │   ├── agent-tools/            # (P4) تفكيك agent-tools.ts
│   │   │   ├── content-repair.ts   # إصلاح محتوى الملفات التالف
│   │   │   ├── state.ts            # إدارة الحالة لكل job
│   │   │   ├── types.ts            # الأنواع (MediaConfig, BuildResult)
│   │   │   └── validate.ts         # التحقق من محتوى الملفات
│   │   ├── orchestrator/           # (P4) تفكيك orchestrator.ts
│   │   │   ├── repair-args.ts      # إصلاح args الـ LLM
│   │   │   └── types.ts            # OrchestratorResult
│   │   ├── abort-registry.ts       # إلغاء العمليات
│   │   ├── agent-registry.ts       # تسجيل الوكلاء (Brain/Builder/Tester)
│   │   ├── agent-tools.ts          # (127KB) أدوات الـ LLM (write_file, done, إلخ)
│   │   ├── build-checker.ts        # فحص البناء
│   │   ├── build-runner.ts         # تشغيل البناء
│   │   ├── crypto.ts               # تشفير
│   │   ├── e2b-runner.ts            # (E2B sandbox) — سيُستبدل بـ Fly.io
│   │   ├── event-emitter.ts        # بث الأحداث
│   │   ├── git-manager.ts          # إدارة Git
│   │   ├── image-gen.ts            # توليد الصور
│   │   ├── index.ts                # نقطة الدخول (Hono server)
│   │   ├── job-processor.ts        # (65KB) معالجة build_jobs
│   │   ├── key-fetcher.ts          # جلب مفاتيح API
│   │   ├── local-build.ts          # البناء المحلي (npm install + build)
│   │   ├── logger.ts               # تسجيل
│   │   ├── orchestrator.ts         # (120KB) منسِّق الوكلاء
│   │   ├── project-spec.ts         # مواصفات المشروع
│   │   ├── provider-registry.ts    # تسجيل مزودي LLM
│   │   ├── r2-client.ts            # Cloudflare R2 client
│   │   ├── session-manager.ts      # إدارة الجلسات
│   │   ├── stack-registry.ts       # تسجيل الـ stacks
│   │   ├── stream-bus.ts           # بث الأحداث للـ frontend
│   │   ├── sub-agent-fork.ts       # تفرّع الوكلاء الفرعيين
│   │   ├── sub-agent-thread.ts     # خيوط الوكلاء الفرعيين
│   │   ├── sub-agent-worker.ts     # وكلاء فرعيون
│   │   ├── video-gen.ts            # توليد الفيديو
│   │   ├── vision.ts               # تحليل الصور (VLM)
│   │   └── workspace-manager.ts    # إدارة مساحة العمل
│   ├── scripts/                    # سكربتات الوركر
│   │   └── auto-pull.sh            # سحب تلقائي للتحديثات
│   ├── deploy/                     # سكربتات النشر
│   ├── package.json                # dependencies (Bun + Hono + E2B + R2)
│   ├── tsconfig.json               # إعدادات TypeScript
│   └── bun.lock                    # lockfile
├── functions/                      # Cloudflare Pages Functions
│   └── preview/
│       └── [[path]].ts             # preview proxy (R2/Supabase → /preview/)
├── public/                         # ملفات ثابتة (1.77MB بعد الضغط)
│   ├── fonts/                      # خطوط Boska
│   ├── icons/                      # أيقونات المزودين (18 SVG)
│   ├── *.webp                      # hero + footer (WebP متحرك)
│   ├── *.png                       # شعارات + علامات
│   ├── *.jpg                       # أيقونة + social preview
│   ├── _headers                    # HTTP headers (cache control)
│   ├── _redirects                  # redirects (/remains)
│   ├── favicon.ico, favicon.svg
│   └── inspector-script.js         # سكربت فحص الـ preview
├── supabase/                       # Supabase migrations + templates
│   ├── migrations/                 # 10 migrations
│   │   ├── 0001_auth_foundation.sql
│   │   ├── 0002_projects.sql
│   │   ├── 0005_deployments.sql
│   │   ├── 0006_build_jobs.sql
│   │   ├── 0007_external_worker.sql
│   │   └── ...
│   └── email-templates/            # قوالب البريد
├── electron/                       # تطبيق الديسكتوب (Electron)
│   ├── main/                       # العملية الرئيسية
│   └── preload/                    # preload scripts
├── sandbox-server/                 # sandbox server مستقل
├── docs/                           # التوثيق
│   ├── archive/                    # توثيق مؤرشف
│   ├── ci-workflows/               # CI workflows المقترحة
│   ├── INFRASTRUCTURE_PLAN.md      # خطة البنية التحتية
│   └── *.md                        # توثيق إضافي
├── scripts/                        # سكربتات عامة
│   ├── clean.js                    # تنظيف
│   ├── electron-dev.mjs            # تطوير Electron
│   └── test-workflows.sh           # اختبار workflows
├── .github/                        # GitHub
│   ├── workflows/
│   │   ├── ci.yml                  # CI (lint + typecheck + test)
│   │   ├── deploy-pages.yml        # نشر Cloudflare Pages
│   │   └── deploy-worker.yml      # نشر Oracle worker
│   ├── CLAUDE.md                   # سياق Claude
│   └── ISSUE_TEMPLATE/             # قوالب Issues
├── types/                          # أنواع TypeScript عامة
├── .husky/                         # Git hooks
├── package.json                    # dependencies + scripts
├── pnpm-lock.yaml                  # lockfile
├── tsconfig.json                   # إعدادات TypeScript
├── vite.config.ts                  # إعدادات Vite
├── vite-electron.config.ts         # Vite config للـ Electron
├── uno.config.ts                   # UnoCSS config
├── wrangler.toml                   # Cloudflare Pages config
├── eslint.config.mjs              # ESLint config
├── .prettierrc, .prettierignore
├── .editorconfig
├── .gitignore
├── Dockerfile, docker-compose.yaml # Docker
├── README.md, CONTRIBUTING.md, FAQ.md, CHANGELOG.md, ROADMAP.md
├── LICENSE (MIT)
└── bindings.sh, pre-start.cjs      # سكربتات بدء التشغيل
```

---

## المسؤوليات حسب المجلد

### `app/` — الواجهة الأمامية (Remix + React)

| المجلد | المسؤولية | التقنيات |
|--------|----------|---------|
| `components/` | مكوّنات UI قابلة لإعادة الاستخدام | React + shadcn/ui + Tailwind |
| `lib/hooks/` | React hooks مخصصة | React hooks + nanostores |
| `lib/stores/` | إدارة الحالة (nanostores) | nanostores |
| `lib/persistence/` | التخزين المحلي (IndexedDB) | IndexedDB + Supabase |
| `routes/` | API endpoints + الصفحات | Remix routes |
| `styles/` | أنماط SCSS + CSS | SCSS + UnoCSS |
| `utils/` | أدوات مساعدة | TypeScript |

### `external-worker/` — الوركر الخارجي (Bun على Oracle)

| الملف | المسؤولية |
|------|----------|
| `index.ts` | خادم Hono — يستقبل build_jobs |
| `job-processor.ts` | معالجة كاملة للـ build_job (65KB) |
| `orchestrator.ts` | منسِّق الوكلاء (Brain → Builder → Tester) (120KB) |
| `agent-tools.ts` | أدوات الـ LLM (write_file, run_shell, done) (127KB) |
| `e2b-runner.ts` | E2B sandbox — **سيُستبدل بـ Fly.io** |
| `r2-client.ts` | Cloudflare R2 client (مع Content-Type) |
| `local-build.ts` | `npm install` + `npm run build` على Oracle |
| `agent-tools/` | (P4) تفكيك: types, state, validate, content-repair |
| `orchestrator/` | (P4) تفكيك: types, repair-args |

### `functions/` — Cloudflare Pages Functions

| الملف | المسؤولية |
|------|----------|
| `preview/[[path]].ts` | preview proxy — يقرأ من R2/Supabase + يضبط Content-Type |

### `supabase/` — قاعدة البيانات

| المجلد | المسؤولية |
|------|----------|
| `migrations/` | 10 migrations (auth, projects, build_jobs, إلخ) |
| `email-templates/` | قوالب البريد (confirm-signup, magic-link, reset-password) |

---

## تدفق البيانات (Data Flow)

```
1. المستخدم يرسل برومبت
   ↓
2. /api/jobs (Remix route) → Supabase build_jobs (status=pending)
   ↓
3. Oracle worker يلتقط الـ job (polling كل 2s)
   ↓
4. orchestrator.ts → runOrchestratedBuild()
   ├── Brain agent (تخطيط)
   ├── Builder agent (كتابة الملفات عبر agent-tools)
   └── Tester agent (فحص)
   ↓
5. الملفات تُرفع لـ R2 + manifest في Supabase
   ↓
6. local-build.ts: npm install + npm run build على Oracle
   ↓
7. dist files تُرفع لـ R2 + Supabase Storage
   ↓
8. validation_result: previewUrl=/preview/, projectId, buildVerified=true
   ↓
9. Frontend يستقبل ready_for_preview via Realtime
   ↓
10. pf_preview=oracle:{projectId}:{chatId} cookie يُضبط
    ↓
11. /preview/ Pages Function تقرأ من Supabase + تضبط Content-Type
    ↓
12. iframe يعرض التطبيق
```

---

## الأوامر المتاحة (Scripts)

| الأمر | الوصف |
|------|------|
| `pnpm run dev` | تشغيل بيئة التطوير (Remix + Vite) |
| `pnpm run build` | بناء الواجهة للإنتاج |
| `pnpm run start` | تشغيل خادم Wrangler محلي |
| `pnpm run deploy` | نشر Cloudflare Pages |
| `pnpm run lint` | فحص الكود (ESLint) |
| `pnpm run typecheck` | فحص الأنواع (tsc) |
| `pnpm run typecheck:all` | فحص الأنواع للتطبيق + الوركر |
| `pnpm run ci` | lint + typecheck + test |
| `pnpm run test` | تشغيل الاختبارات (Vitest) |
| `pnpm run electron:dev` | تطوير تطبيق الديسكتوب |

### أوامر الوركر الخارجي

| الأمر | الوصف |
|------|------|
| `cd external-worker && bun run dev` | تشغيل الوركر (hot reload) |
| `cd external-worker && bun run typecheck` | فحص أنواع الوركر |

---

## البيئات (Environments)

| البيئة | URL/Host | التقنية |
|--------|---------|---------|
| الإنتاج | https://palmkit.app | Cloudflare Pages |
| الوركر | Oracle ARM64 (130.61.131.77) | Bun + systemd |
| قاعدة البيانات | Supabase (ijbosijtfxehmnfhnnuq) | Postgres + Auth + Storage |
| الملفات | Cloudflare R2 + Supabase Storage | dual-upload |

---

## النقاط الحرجة للصيانة

### عند تعديل الـ preview

1. **`functions/preview/[[path]].ts`** — Pages Function (يخدم الـ preview)
2. **`external-worker/src/job-processor.ts`** السطر 1438 — رفع dist لـ R2 + Supabase
3. **`app/lib/hooks/use-worker-sandbox.ts`** — استرجاع الـ preview عند فتح المحادثة

### عند تعديل الـ agent tools

1. **`external-worker/src/agent-tools.ts`** — الـ tools الرئيسية (127KB)
2. **`external-worker/src/agent-tools/`** — (P4) تفكيك: types, state, validate, content-repair
3. **`external-worker/src/agent-registry.ts`** — تسجيل الـ tools المسموحة لكل وكيل

### عند تعديل الـ orchestrator

1. **`external-worker/src/orchestrator.ts`** — المنسِّق الرئيسي (120KB)
2. **`external-worker/src/orchestrator/`** — (P4) تفكيك: types, repair-args
3. **`external-worker/src/agent-registry.ts`** — DEFAULT_AGENT_FLOW (Brain → Builder → Tester)

---

## CI/CD

| Workflow | الملف | المُحفِّز |
|---------|-----|---------|
| CI | `.github/workflows/ci.yml` | PR + push to main |
| Deploy Cloudflare Pages | `.github/workflows/deploy-pages.yml` | push to main |
| Deploy Oracle Worker | `.github/workflows/deploy-worker.yml` | push to main (external-worker/**) |

كل الـ workflows تستخدم `ubuntu-latest` (مجاني للمستودعات العامة) مع `concurrency: cancel-in-progress`.

---

## المراجع

- **[README.md](./README.md)** — نظرة عامة + Quick Start
- **[ROADMAP.md](./ROADMAP.md)** — خارطة الطريق
- **[CHANGELOG.md](./CHANGELOG.md)** — سجل التغييرات
- **[CONTRIBUTING.md](./CONTRIBUTING.md)** — دليل المساهمة
- **[docs/INFRASTRUCTURE_PLAN.md](./INFRASTRUCTURE_PLAN.md)** — خطة البنية التحتية + تحليل AWS Fargate
- **[docs/archive/](./docs/archive/)** — توثيق مؤرشف
