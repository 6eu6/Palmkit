import { classNames } from '~/utils/classNames';

/**
 * PromptSuggestions — small "quick-add" chips that appear on the welcome screen
 * UNDER the input box (before the user sends). Clicking a chip appends its text
 * to the current input — it never replaces what the user typed.
 *
 * Why: a beginner who wrote "build a todo app" often forgets to specify dark
 * mode, persistence, or responsiveness. These chips nudge them toward a richer
 * prompt without an LLM round-trip (zero model cost). The user stays in control
 * — they pick only what they want, and can edit freely.
 *
 * Distinct from ExamplePrompts: those are FULL prompts that start a new build;
 * these are FRAGMENTS that augment the prompt the user is already writing.
 */

interface Suggestion {
  label: string;
  append: string;
  icon: string;
}

const SUGGESTIONS: Suggestion[] = [
  { label: 'Dark mode', append: ' مع وضع داكن (dark mode)', icon: 'i-ph:moon' },
  { label: 'Responsive', append: ' متجاوب بالكامل مع الجوال', icon: 'i-ph:device-mobile' },
  { label: 'Tailwind', append: ' باستخدام Tailwind CSS', icon: 'i-ph:wind' },
  { label: 'Search', append: ' مع ميزة بحث', icon: 'i-ph:magnifying-glass' },
  { label: 'localStorage', append: ' مع حفظ البيانات في localStorage', icon: 'i-ph:database' },
  { label: 'Animations', append: ' مع حركات وانتقالات سلسة', icon: 'i-ph:sparkle' },
  { label: 'Tests', append: ' مع اختبارات أساسية', icon: 'i-ph:check-circle' },
  { label: 'Arabic RTL', append: ' بدعم اللغة العربية و RTL', icon: 'i-ph:text-align-right' },
];

interface PromptSuggestionsProps {
  input: string;
  onAppend: (text: string) => void;
}

export function PromptSuggestions({ input, onAppend }: PromptSuggestionsProps) {
  // Hide chips the user has already added (avoid duplicates).
  const visible = SUGGESTIONS.filter((s) => !input.includes(s.append.trim()));

  if (visible.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap justify-center gap-1.5 mt-3 px-4">
      {visible.map((s) => (
        <button
          key={s.label}
          type="button"
          onClick={() => onAppend(s.append)}
          className={classNames(
            'flex items-center gap-1 px-2.5 py-1 rounded-full',
            'border border-palmkit-elements-borderColor',
            'bg-palmkit-elements-background-depth-2/60',
            'text-[11px] font-medium text-palmkit-elements-textSecondary',
            'hover:border-[var(--pk-glass-border-hi)] hover:text-palmkit-elements-textPrimary',
            'hover:bg-palmkit-elements-item-backgroundActive',
            'active:scale-95 transition-all duration-150',
          )}
        >
          <span className={`${s.icon} text-[12px] opacity-70`} />
          {s.label}
          <span className="i-ph:plus text-[10px] opacity-50" />
        </button>
      ))}
    </div>
  );
}
