/**
 * Suggestion — Horizontal clickable suggestion chips
 * ==================================================
 *
 * Displays a horizontal row of clickable suggestions for user interaction.
 * Each suggestion is a pill with an optional icon.
 *
 * <Suggestion
 *   suggestions={[
 *     { text: "What are the latest trends in AI?", icon: "i-ph:trend-up" },
 *     { text: "How does machine learning work?" },
 *   ]}
 *   onSelect={(text) => console.log(text)}
 * />
 *
 * Monochrome: background-depth-1 pills with border. Hover → depth-2.
 */

import { memo } from 'react';
import { classNames } from '~/utils/classNames';

export interface SuggestionItem {
  text: string;
  icon?: string;
}

interface SuggestionProps {
  suggestions: SuggestionItem[];
  onSelect: (text: string) => void;
  className?: string;
}

function SuggestionImpl({ suggestions, onSelect, className }: SuggestionProps) {
  if (!suggestions || suggestions.length === 0) {
    return null;
  }

  return (
    <div className={classNames('flex flex-wrap gap-2', className)}>
      {suggestions.map((suggestion, idx) => (
        <button
          key={idx}
          onClick={() => onSelect(suggestion.text)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-palmkit-elements-borderColor bg-palmkit-elements-background-depth-1 text-palmkit-elements-textSecondary hover:bg-palmkit-elements-background-depth-2 hover:text-palmkit-elements-textPrimary hover:border-palmkit-elements-textSecondary transition-all duration-150 text-xs"
        >
          {suggestion.icon && <div className={classNames('text-sm', suggestion.icon)} />}
          <span>{suggestion.text}</span>
        </button>
      ))}
    </div>
  );
}

export const Suggestion = memo(SuggestionImpl);
