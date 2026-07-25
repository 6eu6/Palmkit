/**
 * ChainOfThought — Step-by-step AI reasoning visualization
 * ========================================================
 *
 * A collapsible component that visualizes AI reasoning steps with
 * support for search results, images, and step-by-step progress.
 *
 * <ChainOfThought isStreaming={true}>
 *   <ChainOfThought.Step title="Searching for profiles">
 *     <ChainOfThought.SearchResults>
 *       <ChainOfThought.SearchResult url="x.com" title="Profile" />
 *     </ChainOfThought.SearchResults>
 *   </ChainOfThought.Step>
 *   <ChainOfThought.Step title="Found the profile">
 *     <ChainOfThought.Image src="data:..." alt="Profile photo" />
 *   </ChainOfThought.Step>
 * </ChainOfThought>
 *
 * Monochrome: all steps use background-depth-1, border, textSecondary.
 * Active step (last while streaming) gets a subtle pulse on the icon.
 */

import { memo, useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { classNames } from '~/utils/classNames';
import { Shimmer } from './Shimmer';

// ─── Context (simplified — no React context needed for compound pattern) ───

interface ChainOfThoughtProps {
  children: ReactNode;
  isStreaming?: boolean;
  className?: string;
}

function ChainOfThoughtImpl({ children, isStreaming = false, className }: ChainOfThoughtProps) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div
      className={classNames(
        'rounded-md border border-palmkit-elements-borderColor bg-palmkit-elements-background-depth-1',
        className,
      )}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-palmkit-elements-background-depth-2 transition-colors"
      >
        <div
          className={classNames(
            'text-sm text-palmkit-elements-textSecondary transition-transform',
            expanded && 'rotate-90',
            'i-ph:caret-right-bold',
          )}
        />
        <div className="i-ph:tree-structure text-sm text-palmkit-elements-textSecondary" />
        <span className="text-xs font-medium text-palmkit-elements-textPrimary flex-1">
          {isStreaming ? <Shimmer>Chain of thought</Shimmer> : 'Chain of thought'}
        </span>
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 space-y-2">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Step ───────────────────────────────────────────────────────

interface StepProps {
  title: string;
  isActive?: boolean;
  children?: ReactNode;
}

function StepImpl({ title, isActive = false, children }: StepProps) {
  return (
    <div className="ai-slide-in">
      <div className="flex items-start gap-2">
        <div
          className={classNames(
            'mt-0.5 text-sm text-palmkit-elements-textSecondary',
            isActive ? 'i-ph:circle-notch animate-spin' : 'i-ph:check-circle',
          )}
          style={isActive ? { animationDuration: '1.5s' } : undefined}
        />
        <div className="flex-1 min-w-0">
          <div className="text-xs text-palmkit-elements-textPrimary">
            {isActive ? <Shimmer>{title}</Shimmer> : title}
          </div>
          {children && <div className="mt-1.5 space-y-1.5">{children}</div>}
        </div>
      </div>
    </div>
  );
}

// ─── SearchResults ──────────────────────────────────────────────

function SearchResultsImpl({ children }: { children: ReactNode }) {
  return <div className="space-y-1 ml-6 pl-2 border-l border-palmkit-elements-borderColor">{children}</div>;
}

// ─── SearchResult ───────────────────────────────────────────────

function SearchResultImpl({ url, title, snippet }: { url: string; title: string; snippet?: string }) {
  return (
    <div className="ai-fade-in">
      <div className="flex items-center gap-1.5">
        <div className="i-ph:link text-xs text-palmkit-elements-textSecondary" />
        <span className="text-xs text-palmkit-elements-textSecondary truncate">{url}</span>
      </div>
      <div className="text-xs text-palmkit-elements-textPrimary ml-4">{title}</div>
      {snippet && <div className="text-[11px] text-palmkit-elements-textSecondary ml-4 line-clamp-2">{snippet}</div>}
    </div>
  );
}

// ─── Image ──────────────────────────────────────────────────────

function ChainImageImpl({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="ml-6 ai-fade-in">
      <img
        src={src}
        alt={alt}
        className="max-w-xs max-h-32 rounded border border-palmkit-elements-borderColor object-cover"
        loading="lazy"
      />
      {alt && <div className="text-[11px] text-palmkit-elements-textSecondary mt-0.5">{alt}</div>}
    </div>
  );
}

// ─── Export compound ────────────────────────────────────────────

export const ChainOfThought = Object.assign(memo(ChainOfThoughtImpl), {
  Step: memo(StepImpl),
  SearchResults: memo(SearchResultsImpl),
  SearchResult: memo(SearchResultImpl),
  Image: memo(ChainImageImpl),
});
