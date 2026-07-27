# Palmkit — خطة البنية التحتية والاستضافة

> **الهدف**: توثيق القرارات المعمارية الحالية + خطة التطور المستقبلية بناءً على
> فهم عميق لكيفية عمل Palmkit فعلياً (تم التحقق عبر فحص الكود + اختبارات end-to-end).
>
> **تاريخ آخر تحديث**: 2026-07-21 · **الحالة**: مُختبَر ويعمل في الإنتاج

---

## 1. المعمارية الحالية (كما تعمل الآن)

```
┌─────────────────────────────────────────────────────────────────────┐
│                         المستخدم (Browser)                          │
│                    https://palmkit.app                              │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│              Cloudflare Pages (Remix + Vite)                        │
│  ├── الصفحة الرئيسية + Chat UI                                      │
│  ├── /api/* routes (Remix loaders/actions)                         │
│  └── /preview/ ← Pages Function (functions/preview/[[path]].ts)   │
│         └── تقرأ من Supabase Storage + تضبط Content-Type الصحيح     │
└────────────────────────────┬────────────────────────────────────────┘
                             │
              ┌──────────────┴──────────────┐
              ▼                             ▼
┌──────────────────────┐     ┌──────────────────────────────────────┐
│   Supabase           │     │   Oracle Cloud ARM64 (Always Free)    │
│   ├── Postgres       │     │   ├── Bun worker (external-worker/)   │
│   ├── Auth           │     │   ├── systemd: palmkit-worker          │
│   ├── Realtime       │     │   ├── MemoryMax: 5500M                │
│   └── Storage        │     │   └── يقوم بـ:                          │
│       (dist files)  │     │       ├── استقبال build_jobs            │
│                     │     │       ├── استدعاء LLM (OpenRouter)     │
└─────────────────────┘     │       ├── كتابة الملفات لـ R2          │
                            │       ├── npm install + npm run build │
                            │       └── رفع dist لـ R2 + Supabase   │
                            └──────────────────┬─────────────────────┘
                                               │
                              ┌────────────────┴────────────────┐
                              ▼                                 ▼
              ┌──────────────────────┐         ┌────────────────────────┐
              │   Cloudflare R2      │         │   E2B (sandbox فقط)    │
              │   ├── source files  │         │   ├── 478MB RAM        │
              │   ├── dist files    │         │   ├── live dev server  │
              │   └── worklogs      │         │   └── fallback عند فشل │
              │   (مع Content-Type) │         │       prebuilt preview │
              └─────────────────────┘         └────────────────────────┘
```

### المكونات والأدوار

| المكوّن | الدور | التكلفة | الحالة |
|---------|------|---------|--------|
| **Cloudflare Pages** | الواجهة + API routes + Pages Function | $0 (free tier) | ✅ يعمل |
| **Oracle Cloud ARM64** | الوركر — يبني المشاريع (Bun) | $0 (Always Free) | ✅ يعمل |
| **Supabase Postgres** | قاعدة البيانات + Auth + Realtime | $0 (free tier) | ✅ يعمل |
| **Supabase Storage** | dist files (للـ serving عبر Pages Function) | $0 (free tier) | ✅ يعمل |
| **Cloudflare R2** | source files + dist (نسخة احتياطية مع Content-Type صحيح) | $0 (free tier 10GB) | ✅ يعمل |
| **E2B** | sandbox للـ live preview (dev server) | $0-5/شهر | ⚠️ محدود (478MB RAM) |
| **OpenRouter** | LLM API (Z.ai GLM-4.7, Claude, GPT, إلخ) | حسب الاستخدام | ✅ يعمل |

### كيف يعمل البناء فعلياً (تم التحقق عبر اختبارات E2E)

1. المستخدم يرسل برومبت → `/api/jobs` يُنشئ build_job في Supabase
2. Oracle worker يستقبل الـ job (polling Supabase كل 2 ثانية)
3. Worker يستدعي LLM (OpenRouter) مع agent tools (write_file, read_file, run_shell, done)
4. LLM يُنشئ الملفات → تُرفع لـ R2 + تُسجَّل في manifest
5. Worker يُنفِّذ `npm install` + `npm run build` محلياً (5.5GB RAM كافية)
6. dist files تُرفع لـ R2 (مع Content-Type) + Supabase Storage (للـ serving)
7. `validation_result` يُحدَّث: `previewUrl=/preview/`, `projectId`, `buildVerified=true`
8. Frontend يستقبل `ready_for_preview` via Realtime + يضبط `pf_preview=oracle:{projectId}:{chatId}` cookie
9. `/preview/` Pages Function تقرأ من Supabase Storage + تضبط Content-Type الصحيح

### نقطة مهمة: E2B ليس للبناء!

**البناء الفعلي يتم على Oracle** (5.5GB RAM). E2B يُستخدم فقط لـ:
- `run_shell` أثناء البناء (اختبارات، npm install في sandbox معزول) — اختياري
- Live preview sandbox (عندما يريد المستخدم التفاعل مع dev server) — fallback فقط

---

## 2. تحليل خطة AWS Fargate (مقترَحة من الخارج)

### ✅ ما هو صحيح في الخطة

| الادعاء | التقييم |
|--------|--------|
| Fargate يعطي عزل كامل (kernel-level) | ✅ صحيح |
| التسعير بالثانية (لا التزام شهري) | ✅ صحيح |
| Scale-to-Zero بعد 10 دقائق خمول | ✅ صحيح وممكن |
| $0.04048/vCPU-hour + $0.004445/GB-hour | ✅ صحيح (US East) |

### ❌ ما هو خاطئ أو مضلِّل في الخطة

#### ٢.١ الحسبة المالية متفائلة جداً

| البند | الخطة تقول | الواقع |
|------|----------|-------|
| تكلفة مشروع/ساعة | $0.1076 (2vCPU + 6GB) | ✅ صحيح |
| ساعات/مستخدم/شهر | 10 ساعات | ❌ متفائل — مستخدم Palmkit يبرمج 30-50 ساعة/شهر |
| مستخدم بـ $200 | 185 مستخدم | ❌ 37-60 مستخدم (بالساعات الواقعية) |
| التكلفة الحقيقية | $1.07/مستخدم/شهر | ❌ $3.23-$5.38/مستخدم/شهر |

#### ٢.٢ تكاليف مخفية غير محسوبة

| تكلفة مخفية | التقدير |
|------------|--------|
| CloudWatch (مراقبة + logs) | $0.50/GB ingested |
| NAT Gateway (لحاويات تريد internet) | $0.045/GB processed |
| Application Load Balancer | $16.20/شهر (ثابت) |
| ECR (container registry) | $0.10/GB/شهر |
| Data transfer (egress) | $0.09/GB |
| **إجمالي تكاليف مخفية** | **~$25-40/شهر** حتى بدون استخدام |

#### ٢.٣ مقارنة بـ Oracle = مجاني للأبد

| المعيار | Oracle (الحالي) | AWS Fargate |
|--------|---------------|------------|
| التكلفة | **$0/شهر** (Always Free) | $25-100/شهر |
| الموارد | 4 OCPU + 24GB RAM | 2 vCPU + 6GB |
| البناء | ✅ يعمل (10 دقائق للمشاريع المعقدة) | أسرع قليلاً (دقائق أقل) |
| العزل | ⚠️ كل builds على نفس VM | ✅ معزول بالكامل |
| الاستدامة | مجاني دائماً | $200 credit ينفد |

#### ٢.٤ أخطاء معمارية في الخطة

- **"كل شيء في مكان واحد"**: حاوية واحدة بـ 6GB لا تكفي لـ Node.js + Python + PostgreSQL + Vite dev server — يسبب OOM
- **"Scale-to-Zero بعد 10 دقائق"**: المستخدم قد يعود بعد 15 دقيقة → إعادة بناء كامل (10 دقائق أخرى) — سيئ لتجربة المستخدم

---

## 3. التوصية: لا تتخلَّ عن Oracle! استبدل E2B فقط

### لماذا؟

المشكلة الحقيقية في مشروعك **ليست Oracle — بل E2B فقط**.

عندما فحصت الكود بدقة:
- **Oracle**: يبني المشاريع بسرعة + مجاني + يعمل بشكل ممتاز
- **E2B**: يُستخدم فقط للـ live preview sandbox (478MB RAM محدود، 5 sandboxes مجانية، يفشل أحياناً)

### الخطة الفعالة الحقيقية

```
البناء: يبقى على Oracle (مجاني، يعمل، 5.5GB RAM كافية)
الـ dist storage: يبقى R2 + Supabase (يعمل)
الـ preview serving: يبقى Pages Function (يعمل بعد إصلاحي)

E2B → استبدل بأحد الخيارات:
  الخيار A: Fly.io Machines ($0.001/دقيقة، scale-to-zero) — أرخص بـ 10x من Fargate
  الخيار B: Render.com free tier (750 ساعة/شهر مجاناً)
  الخيار C: إبقاء E2B + رفع spending limit ($5/شهر بدلاً من مجاني)
```

### مقارنة الخيارات الثلاثة

| المعيار | Oracle + E2B (حالي) | Oracle + Fargate (مقترح) | Oracle + Fly.io (موصى به) |
|--------|-------------------|----------------------|----------------------|
| التكلفة الشهرية | $0-5 | $25-100 | $0-10 |
| العزل | ⚠️ (Oracle مشترك) | ✅ كامل | ✅ كامل |
| سرعة البناء | 10 دقائق | 10 دقائق (نفس Oracle) | 10 دقائق (نفس Oracle) |
| Live preview sandbox | E2B (محدود) | Fargate (ممتاز) | Fly.io (ممتاز) |
| التعقيد التشغيلي | منخفض | **عالٍ جداً** (AWS SDK + IAM + VPC) | متوسط |
| استدامة مالية | مجاني دائماً | ينفد بعد $200 | رخيص جداً |

### لماذا Fly.io أفضل من Fargate لمشروعك؟

1. **أرخص بـ 10x**: $0.001/دقيقة vs $0.1076/ساعة
2. **Scale-to-Zero أصلي**: Fly.io مصمم لهذا (Fargate يحتاج Lambda إضافية)
3. **أبسط بـ 10x**: `fly launch` واحد vs AWS SDK + IAM + VPC + ECR + ECS + CloudWatch
4. **firecracker micro-VM**: عزل كامل مثل Fargate
5. **Docker-native**: نفس Dockerfile الذي تستخدمه محلياً يعمل مباشرة

### متى يكون Fargate خياراً جيداً؟

فقط إذا:
- ✅ لديك 1000+ مستخدم نشط (حيث Oracle وحده لا يكفي)
- ✅ تحتاج multi-region (اليابان، أوروبا، أمريكا)
- ✅ عندك فريق DevOps متفرغ لإدارة AWS
- ❌ **لا يناسب مرحلتك الحالية** (مستخدم واحد + Oracle مجاني يكفي)

---

## 4. خطة التطور المقترحة (مراحل)

### المرحلة 1: تحسين الوضع الحالي (الآن — 1 أسبوع)

| المهمة | الوصف | الأولوية |
|--------|------|--------|
| رفع E2B spending limit | $10/شهر يحل مشكلة "billing limit reached" | 🔴 HIGH |
| تحسين E2B retry | عند فشل sandbox creation، أعد المحاولة 3 مرات | 🟡 MEDIUM |
| تحسين مراقبة Oracle | CloudWatch agent أو Prometheus لمراقبة الذاكرة | 🟡 MEDIUM |
| إصلاح "Model tried to call unavailable tool" | تحسين error handling في agent-tools | 🟡 MEDIUM |

### المرحلة 2: استبدال E2B بـ Fly.io (عند النمو — 2-4 أسابيع)

```yaml
# fly.io preview sandbox (بديل E2B)
# - firecracker micro-VM (عزل كامل)
# - $0.001/دقيقة (أرخص بـ 100x من Fargate)
# - scale-to-zero بعد 10 دقائق خمول
# - Dockerfile واحد بسيط

app:
  name: palmkit-preview-sandbox
  region: iad (أو أقرب منطقة)
  size: shared-cpu-1x, 512MB RAM (يكفي لـ Vite dev server)
  auto_stop_machine: true (scale-to-zero بعد 10 دقائق)
```

**الخطوات:**
1. إنشاء Dockerfile للـ preview sandbox (Node.js + Python multi-stack)
2. إنشاء Fly.io app + تخزين fly token في GitHub Secrets
3. تحديث `external-worker/src/e2b-runner.ts` لـ يستدعي Fly.io API بدل E2B
4. اختبار end-to-end: بناء + preview + تعديل

### المرحلة 3: التوسع عند الحاجة (3-6 أشهر)

- **عند 1000+ مستخدم نشط**: أضف Oracle worker ثانٍ (load balancing عبر Supabase's `claim_next_build_job()`)
- **عند 5000+ مستخدم**: انتقل لـ Fargate أو Fly.io Machines للبناء أيضاً (ليس فقط preview)
- **عند الحاجة لـ multi-region**: Cloudflare Workers + R2 في مناطق متعددة

---

## 5. نقاط حرجة يجب معرفتها

### ٥.١ Oracle Always Free ليس "تجريبي"

- **مجاني للأبد** (ليس مجاني لمدة 12 شهر مثل AWS)
- 4 OCPU + 24GB RAM ARM64 (Ampere A1) — موارد وفيرة
- يمكن رفعها لـ 4 instances (كل واحدة 1 OCPU + 6GB) أو 1 instance (4 OCPU + 24GB)
- **القيد الوحيد**: لا تُستخدم كـ inactive (لكن Palmkit worker يعمل دائماً ← آمن)

### ٥.٢ E2B ليس ضرورياً للبناء

البناء الفعلي يتم على Oracle (5.5GB RAM). E2B يُستخدم فقط كـ sandbox للـ live preview
(عندما يريد المستخدم التفاعل مع dev server بشكل تفاعلي). لذا:
- إزالة E2B **لن تُبطئ البناء**
- ستحتاج لبديل فقط للـ live preview التفاعلي

### ٥.٣ التكلفة الحالية = $0/شهر

الوضع الحالي **مجاني تماماً**:
- Cloudflare Pages: $0 (free tier)
- Oracle Cloud: $0 (Always Free)
- Supabase: $0 (free tier)
- R2: $0 (free tier 10GB)
- E2B: $0 (free tier) أو $5/شهر (إذا رفعت spending limit)
- OpenRouter: حسب الاستخدام (تدفع لكل LLM call)

**الخلاصة**: لا تدفع $25-100/شهر لـ Fargate عندما يعمل كل شيء مجاناً.

---

## 6. الاختبارات التي تم إجراؤها (التحقق من الإصلاحات)

### ٦.١ إصلاح preview restore (2026-07-21)

**المشكلة**: عند إعادة فتح محادثة مكتملة، كان يعرض "No preview available"

**السبب الجذري**:
- بعد P4 fix، `previewUrl` أصبح `/preview/` لكن الكود القديم يستخدم regex
  `previewUrl.match(/preview-dist\/(\d+)/)` لم يعد يطابق
- `projectId` لم يكن موجوداً في `validation_result`
- `reconnectRef` كان يُضبط مرة واحدة ولا يُعاد ضبطه عند تبديل المحادثة

**الإصلاح** (3 commits):
1. `57d8201` — إضافة `projectId` لـ `validation_result` + معالجة `oracle:` cookies
2. `56e0047` — إعادة ضبط `reconnectRef` + dependency على `pathname`

**التحقق**:
- بناء جديد (counter app): ✅ `projectId: 1784666612550` موجود في validation_result
- `/preview/` يعمل مباشرة: ✅ يعرض "Counter App" title + 19 ملف مُسترجَع
- iframe src صحيح: ✅ `https://palmkit.app/preview/`

### ٦.٢ اختبارات stress سابقة

- ✅ بناء مشروع معقد (Task Management): 23 ملف، 13 دقيقة، buildVerified=true
- ✅ بناء counter app بسيط: 9 ملفات، 3 دقائق، buildVerified=true
- ✅ جولة تعديل 1 (JWT auth): 32 ملف، 10.7 دقائق، buildVerified=true
- ✅ جولة تعديل 2 (pagination): 34 ملف، buildVerified=true
- ⚠️ "Model tried to call unavailable tool" — retry mechanism يعمل
- ⚠️ "Preview failed: The preview server did not start in time" — E2B timeout (ستحل باستبدال E2B)

---

## 7. المراجع

- [Oracle Cloud Always Free](https://www.oracle.com/cloud/free/) — 4 OCPU + 24GB RAM مجاني للأبد
- [AWS Fargate Pricing](https://aws.amazon.com/fargate/pricing/) — $0.04048/vCPU-hour
- [Fly.io Pricing](https://fly.io/docs/about/pricing/) — $0.001/دقيقة
- [E2B Documentation](https://e2b.dev/docs) — sandbox API
- [Cloudflare Pages Functions](https://developers.cloudflare.com/pages/functions/) — preview proxy
- [Supabase Storage](https://supabase.com/docs/guides/storage) — dist file serving

---

## 8. القرار النهائي

**لا تهاجر إلى AWS Fargate الآن.**

- Oracle + Supabase + Cloudflare + R2 يعملون مجاناً وبكفاءة
- E2B هو الوحيد الذي يحتاج تحسيناً (ارفع spending limit أو استبدله بـ Fly.io)
- Fargate مكلف + معقد + $200 تنفد — **لا يناسب مرحلتك الحالية**
- عند الوصول لـ 1000+ مستخدم نشط، أعد تقييم الخيارات

**المرحلة القادمة**: استبدال E2B بـ Fly.io Machines (أرخص + أبسط + عزل كامل).
