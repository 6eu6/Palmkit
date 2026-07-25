/**
 * ModelSelector — Searchable model picker
 * ========================================
 *
 * A searchable command palette for selecting AI models.
 * Opens as a popover with a search input + filtered model list.
 *
 * <ModelSelector
 *   models={[{ id: "gpt-4o", name: "GPT-4o", provider: "OpenAI" }]}
 *   selected="gpt-4o"
 *   onSelect={(id) => setModel(id)}
 * />
 *
 * Monochrome: popover uses background-depth-1. Selected item has
 * a subtle background tint + check icon. No colored badges.
 * Icon: i-ph:cpu for the trigger, i-ph:magnifying-glass for search.
 */

import { memo, useState, useMemo } from 'react';
import { classNames } from '~/utils/classNames';

export interface ModelOption {
  id: string;
  name: string;
  provider: string;
}

interface ModelSelectorProps {
  models: ModelOption[];
  selected?: string;
  onSelect: (id: string) => void;
  className?: string;
}

function ModelSelectorImpl({ models, selected, onSelect, className }: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selectedModel = models.find((m) => m.id === selected);

  const filtered = useMemo(() => {
    if (!query.trim()) {
      return models;
    }

    const q = query.toLowerCase();

    return models.filter(
      (m) => m.name.toLowerCase().includes(q) || m.provider.toLowerCase().includes(q) || m.id.toLowerCase().includes(q),
    );
  }, [models, query]);

  return (
    <div className={classNames('relative', className)}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 h-7 px-2.5 rounded-full border border-palmkit-elements-borderColor text-palmkit-elements-textSecondary hover:text-palmkit-elements-textPrimary hover:border-palmkit-elements-textSecondary transition-all"
      >
        <div className="i-ph:cpu text-[13px]" />
        <span className="text-[11px] font-medium max-w-[100px] truncate">{selectedModel?.name || 'Select model'}</span>
        <div
          className={classNames('i-ph:text-[10px] transition-transform', open ? 'i-ph:caret-up' : 'i-ph:caret-down')}
        />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute z-40 bottom-full mb-1 left-0 w-72 max-h-80 rounded-md border border-palmkit-elements-borderColor bg-palmkit-elements-background-depth-1 shadow-lg overflow-hidden ai-fade-in">
            {/* Search */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-palmkit-elements-borderColor">
              <div className="i-ph:magnifying-glass text-sm text-palmkit-elements-textSecondary" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search models…"
                className="flex-1 bg-transparent border-0 outline-none text-xs text-palmkit-elements-textPrimary placeholder:text-palmkit-elements-textSecondary"
                autoFocus
              />
            </div>

            {/* List */}
            <div className="max-h-60 overflow-y-auto modern-scrollbar">
              {filtered.length === 0 ? (
                <div className="px-3 py-4 text-xs text-palmkit-elements-textSecondary text-center">No models found</div>
              ) : (
                filtered.map((model) => (
                  <button
                    key={model.id}
                    onClick={() => {
                      onSelect(model.id);
                      setOpen(false);
                      setQuery('');
                    }}
                    className={classNames(
                      'flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-palmkit-elements-background-depth-2 transition-colors',
                      model.id === selected && 'bg-palmkit-elements-background-depth-2',
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-palmkit-elements-textPrimary truncate">{model.name}</div>
                      <div className="text-[10px] text-palmkit-elements-textSecondary">{model.provider}</div>
                    </div>
                    {model.id === selected && (
                      <div className="i-ph:check text-sm text-palmkit-elements-textSecondary" />
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export const ModelSelector = memo(ModelSelectorImpl);
