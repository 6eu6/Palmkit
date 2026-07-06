/**
 * Clarify rules — lightweight heuristics that suggest 1–2 clarifying questions
 * for short/vague build prompts. NO LLM call: pure string matching on the prompt.
 *
 * Why no LLM: an LLM clarifier is just the prompt-enhancer problem rebranded —
 * it adds latency + token cost before the builder. Instead we detect a handful
 * of high-signal keyword patterns and offer concrete, clickable answers. The
 * user picks what they want, we append it to their prompt, and the builder runs
 * with a richer spec — at zero extra model cost.
 *
 * If the prompt doesn't match any pattern, or is already detailed, we return
 * null and the builder runs directly.
 */

export interface ClarifyQuestion {
  prompt: string;
  options: { label: string; append: string }[];
}

const MIN_LEN = 12;
const MAX_LEN = 110;

/**
 * Heuristic: a prompt is a candidate for clarification if it's short and vague.
 * Long, detailed prompts already carry their own spec — don't second-guess them.
 */
export function shouldClarify(prompt: string): boolean {
  const text = prompt.trim();
  return text.length >= MIN_LEN && text.length <= MAX_LEN;
}

/**
 * Pick clarifying questions based on keyword patterns in the prompt.
 * Returns null if no pattern matches (builder runs directly).
 */
export function getClarifyQuestions(prompt: string): ClarifyQuestion[] {
  const p = prompt.toLowerCase();
  const questions: ClarifyQuestion[] = [];

  // Pattern: app / application / تطبيق → ask about core features
  if (/\b(app|application|تطبيق|أب)\b/.test(p)) {
    questions.push({
      prompt: 'ما الميزات الأساسية التي تريدها؟',
      options: [
        { label: 'تسجيل دخول', append: 'مع نظام تسجيل دخول للمستخدمين' },
        { label: 'بحث', append: 'مع ميزة بحث سريعة' },
        { label: 'إشعارات', append: 'مع نظام إشعارات داخل التطبيق' },
        { label: 'dashboard', append: 'مع لوحة تحكم تعرض الإحصائيات' },
      ],
    });
  }

  // Pattern: website / site / موقع / صفحة → ask about the goal
  if (/\b(website|site|landing|page|موقع|صفحة|متجر)\b/.test(p)) {
    questions.push({
      prompt: 'ما الهدف الرئيسي؟',
      options: [
        { label: 'معرض أعمال', append: 'بأسلوب portfolio أنيق' },
        { label: 'متجر', append: 'مع عرض منتجات وسلة تسوق' },
        { label: 'مدونة', append: 'مع نظام مقالات ووسوم' },
        { label: 'landing', append: 'بأسلوب landing page تسويقية' },
      ],
    });
  }

  // Pattern: dashboard / لوحة → ask about data source
  if (/\b(dashboard|admin|لوحة|تحكم)\b/.test(p)) {
    questions.push({
      prompt: 'ما مصدر البيانات؟',
      options: [
        { label: 'بيانات وهمية', append: 'يستخدم بيانات وهمية واقعية للعرض' },
        { label: 'localStorage', append: 'يحفظ البيانات في localStorage' },
        { label: 'API', append: 'يجلب البيانات من API خارجي' },
      ],
    });
  }

  // Pattern: game / لعبة → ask about scoring
  if (/\b(game|لعبة)\b/.test(p)) {
    questions.push({
      prompt: 'كيف يعمل نظام النقاط؟',
      options: [
        { label: 'high score', append: 'مع حفظ أعلى نتيجة محلياً' },
        { label: 'مستويات', append: 'مع مستويات متدرجة الصعوبة' },
        { label: 'timer', append: 'مع مؤقت زمني تحدي' },
      ],
    });
  }

  // Always-offered design question (universal)
  questions.push({
    prompt: 'تفاصيل التصميم؟',
    options: [
      { label: 'dark mode', append: 'مع وضع داكن (dark mode)' },
      { label: 'responsive', append: 'متجاوب بالكامل مع الجوال' },
      { label: 'animations', append: 'مع حركات وانتقالات سلسة' },
      { label: 'minimal', append: 'بتصميم minimal نظيف' },
    ],
  });

  return questions;
}
