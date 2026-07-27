import { useState, useEffect } from 'react';
import type { ElementInfo } from './Inspector';

interface InspectorPanelProps {
  selectedElement: ElementInfo | null;
  isVisible: boolean;
  onClose: () => void;
  onApplyEdit: (prompt: string) => void;
}

interface EditState {
  text: string;
  backgroundColor: string;
  color: string;
  fontSize: string;
  padding: string;
  borderRadius: string;
  fontWeight: string;
}

const TEXT_TAGS = new Set([
  'span',
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'button',
  'a',
  'label',
  'li',
  'td',
  'th',
  'div',
]);

function stripPx(val: string): string {
  return val.replace(/px$/, '').trim();
}

function normHex(val: string): string {
  if (!val) {
    return '#000000';
  }

  // Convert rgb(r,g,b) → #rrggbb
  const m = val.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);

  if (m) {
    return '#' + [m[1], m[2], m[3]].map((n) => parseInt(n).toString(16).padStart(2, '0')).join('');
  }

  if (val.startsWith('#')) {
    return val;
  }

  return '#000000';
}

function buildEditPrompt(el: ElementInfo, orig: EditState, next: EditState): string {
  const tag = el.tagName.toLowerCase();
  const sel = el.selector || tag;
  const changes: string[] = [];

  const isTextEl = TEXT_TAGS.has(tag);

  if (isTextEl && next.text.trim() && next.text.trim() !== orig.text.trim()) {
    changes.push(`- Change the text content from "${orig.text.slice(0, 60)}" to "${next.text.slice(0, 60)}"`);
  }

  if (next.backgroundColor !== orig.backgroundColor) {
    changes.push(`- Change the background-color to ${next.backgroundColor}`);
  }

  if (next.color !== orig.color) {
    changes.push(`- Change the text color to ${next.color}`);
  }

  if (next.fontSize.trim() && next.fontSize !== orig.fontSize) {
    const v = next.fontSize.replace(/px$/, '');
    changes.push(`- Change the font-size to ${v}px`);
  }

  if (next.padding.trim() && next.padding !== orig.padding) {
    const v = next.padding.replace(/px$/, '');
    changes.push(`- Change the padding to ${v}px`);
  }

  if (next.borderRadius.trim() && next.borderRadius !== orig.borderRadius) {
    const v = next.borderRadius.replace(/px$/, '');
    changes.push(`- Change the border-radius to ${v}px`);
  }

  if (next.fontWeight !== orig.fontWeight) {
    changes.push(`- Change the font-weight to ${next.fontWeight}`);
  }

  if (changes.length === 0) {
    return '';
  }

  const pathHint = el.elementPath ? ` (path: ${el.elementPath})` : '';

  return `Edit the \`${sel}\`${pathHint} element in the preview:\n${changes.join('\n')}`;
}

export const InspectorPanel = ({ selectedElement, isVisible, onClose, onApplyEdit }: InspectorPanelProps) => {
  const [activeTab, setActiveTab] = useState<'edit' | 'styles' | 'box'>('edit');
  const [editState, setEditState] = useState<EditState>({
    text: '',
    backgroundColor: '#ffffff',
    color: '#000000',
    fontSize: '',
    padding: '',
    borderRadius: '',
    fontWeight: '400',
  });
  const [origState, setOrigState] = useState<EditState | null>(null);

  useEffect(() => {
    if (!selectedElement) {
      return;
    }

    const s = selectedElement.styles;
    const next: EditState = {
      text: selectedElement.innerText || selectedElement.textContent || '',
      backgroundColor: normHex(s['background-color'] || s.background || '#ffffff'),
      color: normHex(s.color || '#000000'),
      fontSize: stripPx(s['font-size'] || '16'),
      padding: stripPx(s.padding || s['padding-top'] || '0'),
      borderRadius: stripPx(s['border-radius'] || '0'),
      fontWeight: s['font-weight'] || '400',
    };
    setEditState(next);
    setOrigState(next);
  }, [selectedElement]);

  if (!isVisible || !selectedElement) {
    return null;
  }

  const tag = selectedElement.tagName.toLowerCase();
  const isTextEl = TEXT_TAGS.has(tag);

  const handleApply = () => {
    if (!origState) {
      return;
    }

    const prompt = buildEditPrompt(selectedElement, origState, editState);

    if (!prompt) {
      return;
    }

    onApplyEdit(prompt);
  };

  const set = (key: keyof EditState, val: string) => setEditState((p) => ({ ...p, [key]: val }));

  const hasChanges =
    origState !== null &&
    JSON.stringify({ ...editState, text: editState.text.trim() }) !==
      JSON.stringify({ ...origState, text: origState.text.trim() });

  return (
    <div
      className="absolute right-2 top-12 w-72 bg-palmkit-elements-background border border-palmkit-elements-borderColor rounded-lg shadow-xl z-50 flex flex-col max-h-[calc(100%-4rem)] overflow-hidden"
      style={{ backdropFilter: 'blur(8px)' }}
    >
      {/* Header */}
      <div className="flex items-start justify-between px-3 py-2 border-b border-palmkit-elements-borderColor flex-shrink-0">
        <div className="min-w-0 flex-1 pr-2">
          <div className="flex items-center gap-1 text-xs font-mono">
            <span className="text-blue-400">{tag}</span>
            {selectedElement.id && <span className="text-green-400">#{selectedElement.id}</span>}
            {selectedElement.className && (
              <span className="text-yellow-400 truncate">.{selectedElement.className.split(' ')[0]}</span>
            )}
          </div>
          {selectedElement.elementPath && (
            <div
              className="text-[10px] text-palmkit-elements-textTertiary mt-0.5 truncate"
              title={selectedElement.elementPath}
            >
              {selectedElement.elementPath}
            </div>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-palmkit-elements-textSecondary hover:text-palmkit-elements-textPrimary flex-shrink-0 mt-0.5"
          title="Close"
        >
          <div className="i-ph:x text-sm" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-palmkit-elements-borderColor flex-shrink-0">
        {(['edit', 'styles', 'box'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-1.5 text-xs capitalize flex-1 transition-colors ${
              activeTab === tab
                ? 'border-b-2 border-blue-500 text-blue-500 font-medium'
                : 'text-palmkit-elements-textSecondary hover:text-palmkit-elements-textPrimary'
            }`}
          >
            {tab === 'edit' ? '✏️ Edit' : tab}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="overflow-y-auto flex-1 p-3">
        {activeTab === 'edit' && (
          <div className="space-y-3">
            {/* Text content */}
            {isTextEl && (
              <Field label="Text">
                <input
                  type="text"
                  value={editState.text}
                  onChange={(e) => set('text', e.target.value)}
                  className="w-full px-2 py-1 text-xs bg-palmkit-elements-background-depth-1 border border-palmkit-elements-borderColor rounded text-palmkit-elements-textPrimary focus:border-blue-500 focus:outline-none"
                  placeholder="text content…"
                />
              </Field>
            )}

            {/* Colors row */}
            <div className="grid grid-cols-2 gap-2">
              <Field label="Background">
                <div className="flex items-center gap-1.5">
                  <input
                    type="color"
                    value={editState.backgroundColor}
                    onChange={(e) => set('backgroundColor', e.target.value)}
                    className="w-7 h-7 rounded border border-palmkit-elements-borderColor cursor-pointer p-0.5 bg-transparent"
                  />
                  <input
                    type="text"
                    value={editState.backgroundColor}
                    onChange={(e) => set('backgroundColor', e.target.value)}
                    className="flex-1 px-1.5 py-1 text-[10px] bg-palmkit-elements-background-depth-1 border border-palmkit-elements-borderColor rounded text-palmkit-elements-textPrimary focus:border-blue-500 focus:outline-none font-mono"
                  />
                </div>
              </Field>

              <Field label="Text Color">
                <div className="flex items-center gap-1.5">
                  <input
                    type="color"
                    value={editState.color}
                    onChange={(e) => set('color', e.target.value)}
                    className="w-7 h-7 rounded border border-palmkit-elements-borderColor cursor-pointer p-0.5 bg-transparent"
                  />
                  <input
                    type="text"
                    value={editState.color}
                    onChange={(e) => set('color', e.target.value)}
                    className="flex-1 px-1.5 py-1 text-[10px] bg-palmkit-elements-background-depth-1 border border-palmkit-elements-borderColor rounded text-palmkit-elements-textPrimary focus:border-blue-500 focus:outline-none font-mono"
                  />
                </div>
              </Field>
            </div>

            {/* Numeric props */}
            <div className="grid grid-cols-2 gap-2">
              <Field label="Font Size (px)">
                <input
                  type="number"
                  value={editState.fontSize}
                  onChange={(e) => set('fontSize', e.target.value)}
                  className="w-full px-2 py-1 text-xs bg-palmkit-elements-background-depth-1 border border-palmkit-elements-borderColor rounded text-palmkit-elements-textPrimary focus:border-blue-500 focus:outline-none"
                  min="1"
                  max="200"
                  placeholder="16"
                />
              </Field>
              <Field label="Font Weight">
                <select
                  value={editState.fontWeight}
                  onChange={(e) => set('fontWeight', e.target.value)}
                  className="w-full px-2 py-1 text-xs bg-palmkit-elements-background-depth-1 border border-palmkit-elements-borderColor rounded text-palmkit-elements-textPrimary focus:border-blue-500 focus:outline-none"
                >
                  {['300', '400', '500', '600', '700', '800', '900'].map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Padding (px)">
                <input
                  type="number"
                  value={editState.padding}
                  onChange={(e) => set('padding', e.target.value)}
                  className="w-full px-2 py-1 text-xs bg-palmkit-elements-background-depth-1 border border-palmkit-elements-borderColor rounded text-palmkit-elements-textPrimary focus:border-blue-500 focus:outline-none"
                  min="0"
                  placeholder="0"
                />
              </Field>
              <Field label="Border Radius (px)">
                <input
                  type="number"
                  value={editState.borderRadius}
                  onChange={(e) => set('borderRadius', e.target.value)}
                  className="w-full px-2 py-1 text-xs bg-palmkit-elements-background-depth-1 border border-palmkit-elements-borderColor rounded text-palmkit-elements-textPrimary focus:border-blue-500 focus:outline-none"
                  min="0"
                  placeholder="0"
                />
              </Field>
            </div>

            {/* Apply button */}
            <button
              onClick={handleApply}
              disabled={!hasChanges}
              className={`w-full py-2 px-3 rounded-md text-sm font-medium transition-all ${
                hasChanges
                  ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm'
                  : 'bg-palmkit-elements-background-depth-1 text-palmkit-elements-textTertiary cursor-not-allowed'
              }`}
            >
              {hasChanges ? '→ Send Edit to Chat' : 'Make changes above to apply'}
            </button>

            {!hasChanges && (
              <p className="text-[10px] text-palmkit-elements-textTertiary text-center">
                Modify any property above, then click Apply to generate an AI edit prompt.
              </p>
            )}
          </div>
        )}

        {activeTab === 'styles' && (
          <div className="space-y-1">
            {Object.entries(selectedElement.styles).length === 0 ? (
              <p className="text-xs text-palmkit-elements-textTertiary">No computed styles captured.</p>
            ) : (
              Object.entries(selectedElement.styles).map(([prop, value]) => (
                <div key={prop} className="flex justify-between text-xs gap-2">
                  <span className="text-palmkit-elements-textSecondary font-mono flex-shrink-0">{prop}:</span>
                  <span className="text-palmkit-elements-textPrimary font-mono text-right truncate" title={value}>
                    {value}
                  </span>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'box' && (
          <div className="space-y-2">
            <BoxRow label="Width" value={`${Math.round(selectedElement.rect.width)}px`} />
            <BoxRow label="Height" value={`${Math.round(selectedElement.rect.height)}px`} />
            <BoxRow label="Top (page)" value={`${Math.round(selectedElement.rect.top)}px`} />
            <BoxRow label="Left (page)" value={`${Math.round(selectedElement.rect.left)}px`} />
            <BoxRow
              label="Top (viewport)"
              value={`${Math.round(selectedElement.rect.viewportTop ?? selectedElement.rect.top)}px`}
            />
            <BoxRow
              label="Left (viewport)"
              value={`${Math.round(selectedElement.rect.viewportLeft ?? selectedElement.rect.left)}px`}
            />
            <div className="mt-3 pt-3 border-t border-palmkit-elements-borderColor">
              <p className="text-[10px] text-palmkit-elements-textTertiary font-mono">{selectedElement.selector}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] text-palmkit-elements-textSecondary uppercase tracking-wide font-medium">
        {label}
      </label>
      {children}
    </div>
  );
}

function BoxRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-palmkit-elements-textSecondary">{label}:</span>
      <span className="text-palmkit-elements-textPrimary font-mono">{value}</span>
    </div>
  );
}
