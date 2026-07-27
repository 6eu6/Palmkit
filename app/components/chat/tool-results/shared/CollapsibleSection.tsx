/**
 * CollapsibleSection
 * ==================
 * Generic collapsible <details>-like component with smooth animation.
 * Used by all renderers to show "Raw JSON", "Details", "Show more", etc.
 */

import { memo, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { classNames } from '~/utils/classNames';
import { cubicEasingFn } from '~/utils/easings';

interface CollapsibleSectionProps {
  title: string;
  children: ReactNode;

  /** Default expanded state. Default: false. */
  defaultExpanded?: boolean;

  /** Optional badge count (e.g. "3 results", "15KB"). */
  badge?: string;

  /** Optional icon class. */
  iconClass?: string;
}

function CollapsibleSectionImpl({
  title,
  children,
  defaultExpanded = false,
  badge,
  iconClass = 'i-ph:caret-right-bold',
}: CollapsibleSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className="border border-palmkit-elements-borderColor rounded-md overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center w-full px-3 py-2 text-left bg-palmkit-elements-background-depth-2 hover:bg-palmkit-elements-artifacts-backgroundHover transition-colors"
      >
        <div
          className={classNames(
            'text-sm text-palmkit-elements-textSecondary transition-transform mr-2',
            expanded && 'rotate-90',
            iconClass,
          )}
        />
        <span className="text-xs font-medium text-palmkit-elements-textPrimary flex-1">{title}</span>
        {badge && (
          <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] bg-palmkit-elements-background-depth-3 text-palmkit-elements-textSecondary">
            {badge}
          </span>
        )}
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={{ duration: 0.15, ease: cubicEasingFn }}
            className="overflow-hidden"
          >
            <div className="p-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export const CollapsibleSection = memo(CollapsibleSectionImpl);
