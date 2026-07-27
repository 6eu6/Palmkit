import { useState, type PropsWithChildren } from 'react';

/**
 * ThoughtBox — displays AI reasoning/thinking content.
 *
 * During streaming: EXPANDED by default so user sees reasoning in real-time.
 * After streaming: auto-collapses after 2 seconds.
 *
 * The component detects streaming by checking if children content is still
 * growing (content length changes trigger re-render).
 */
const ThoughtBox = ({ title, children }: PropsWithChildren<{ title: string }>) => {
  // Start EXPANDED — user sees thinking in real-time
  const [isExpanded, setIsExpanded] = useState(true);
  const [isStreaming, setIsStreaming] = useState(true);
  const lastLengthRef = useState({ current: 0 })[0];
  const stableTimerRef = useState({ current: null as ReturnType<typeof setTimeout> | null })[0];

  // Detect when content stops growing → streaming finished
  const childText = typeof children === 'string' ? children : String(children ?? '');
  const currentLength = childText.length;

  if (currentLength !== lastLengthRef.current) {
    lastLengthRef.current = currentLength;
    setIsStreaming(true);

    // Clear any existing timer
    if (stableTimerRef.current) {
      clearTimeout(stableTimerRef.current);
    }

    // Set a timer: if content doesn't change for 2s, consider streaming done
    stableTimerRef.current = setTimeout(() => {
      setIsStreaming(false);

      // Auto-collapse after streaming finishes
      setIsExpanded(false);
    }, 2000);
  }

  return (
    <div
      onClick={() => setIsExpanded(!isExpanded)}
      className={`
        bg-palmkit-elements-background-depth-2
        shadow-md
        rounded-lg
        cursor-pointer
        transition-all
        duration-300
        ${isExpanded ? 'max-h-[32rem]' : 'max-h-14'}
        overflow-auto
        border border-palmkit-elements-borderColor
      `}
    >
      <div className="p-4 flex items-center gap-3 rounded-lg text-palmkit-elements-textSecondary font-medium leading-5 text-sm">
        <div className={`i-ph:brain-thin text-xl ${isStreaming ? 'animate-pulse' : ''}`} />
        <span>{title}</span>
        {isStreaming && <span className="text-xs text-palmkit-elements-textTertiary animate-pulse">thinking…</span>}
        {!isStreaming && !isExpanded && <span className="text-palmkit-elements-textTertiary"> - Click to expand</span>}
      </div>
      <div
        className={`
        transition-opacity
        duration-300
        p-4
        rounded-lg
        text-xs text-palmkit-elements-textSecondary leading-relaxed whitespace-pre-wrap
        ${isExpanded ? 'opacity-100' : 'opacity-0'}
      `}
      >
        {children}
      </div>
    </div>
  );
};

export default ThoughtBox;
