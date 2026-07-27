import React, { useState, useEffect } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { classNames } from '~/utils/classNames';
import type { DesignScheme } from '~/types/design-scheme';
import { defaultDesignScheme, designFeatures, designFonts, paletteRoles } from '~/types/design-scheme';

/**
 * ColorSchemeDialog — a compact, mobile-first popover for design customization.
 *
 * Redesigned from the old 480px-wide modal with tabs into a single elegant
 * popover anchored to the palette icon. Everything is visible in one scroll:
 * palette swatches (tap to edit), font chips (tap to toggle), feature chips.
 * No tabs to hide content behind — the user sees and adjusts all three at once.
 *
 * The palette feeds the builder's system prompt as JSON (PALETTE / FONT /
 * FEATURES), so every change here directly steers the next build.
 */
export interface ColorSchemeDialogProps {
  designScheme?: DesignScheme;
  setDesignScheme?: (scheme: DesignScheme) => void;
}

export const ColorSchemeDialog: React.FC<ColorSchemeDialogProps> = ({ setDesignScheme, designScheme }) => {
  const [palette, setPalette] = useState<{ [key: string]: string }>(() => {
    if (designScheme?.palette) {
      return { ...defaultDesignScheme.palette, ...designScheme.palette };
    }

    return defaultDesignScheme.palette;
  });

  const [features, setFeatures] = useState<string[]>(designScheme?.features || defaultDesignScheme.features);
  const [font, setFont] = useState<string[]>(designScheme?.font || defaultDesignScheme.font);
  const [open, setOpen] = useState(false);
  const [editingColor, setEditingColor] = useState<string | null>(null);

  useEffect(() => {
    if (designScheme) {
      setPalette(() => ({ ...defaultDesignScheme.palette, ...designScheme.palette }));
      setFeatures(designScheme.features || defaultDesignScheme.features);
      setFont(designScheme.font || defaultDesignScheme.font);
    } else {
      setPalette(defaultDesignScheme.palette);
      setFeatures(defaultDesignScheme.features);
      setFont(defaultDesignScheme.font);
    }
  }, [designScheme]);

  const handleColorChange = (role: string, value: string) => {
    setPalette((prev) => ({ ...prev, [role]: value }));
  };

  const handleFeatureToggle = (key: string) => {
    setFeatures((prev) => (prev.includes(key) ? prev.filter((f) => f !== key) : [...prev, key]));
  };

  const handleFontToggle = (key: string) => {
    setFont((prev) => (prev.includes(key) ? prev.filter((f) => f !== key) : [...prev, key]));
  };

  const handleSave = () => {
    setDesignScheme?.({ palette, features, font });
    setOpen(false);
  };

  const handleReset = () => {
    setPalette(defaultDesignScheme.palette);
    setFeatures(defaultDesignScheme.features);
    setFont(defaultDesignScheme.font);
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          title="Design palette"
          aria-label="Design palette"
          className={classNames(
            'shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-150 active:scale-90',
            open
              ? 'bg-palmkit-elements-item-backgroundActive text-palmkit-elements-textPrimary'
              : 'text-palmkit-elements-textTertiary hover:text-palmkit-elements-textPrimary hover:bg-palmkit-elements-item-backgroundActive',
          )}
        >
          <div className="i-ph:palette text-[18px]" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="center"
          sideOffset={10}
          collisionPadding={12}
          className={classNames(
            'pk-no-fullscreen z-[9999] w-[min(340px,calc(100vw-1.5rem))]',
            'rounded-2xl border border-palmkit-elements-borderColor',
            'bg-palmkit-elements-background-depth-2 shadow-2xl',
            'max-h-[70vh] flex flex-col',
          )}
          style={{ animation: 'pk-palette-in 0.16s cubic-bezier(0.16, 1, 0.3, 1)', transformOrigin: 'bottom center' }}
        >
          <style>
            {
              '@keyframes pk-palette-in{from{opacity:0;transform:translateY(6px) scale(0.98)}to{opacity:1;transform:none}}'
            }
          </style>

          {/* Header */}
          <div className="flex items-center justify-between px-4 pt-3.5 pb-2.5 border-b border-palmkit-elements-borderColor/70">
            <div className="flex items-center gap-2">
              <div className="i-ph:palette text-base text-palmkit-elements-textSecondary" />
              <span className="text-[13px] font-semibold text-palmkit-elements-textPrimary">Design</span>
            </div>
            <button
              onClick={handleReset}
              className="flex items-center gap-1 text-[11px] text-palmkit-elements-textTertiary hover:text-palmkit-elements-textPrimary transition-colors"
            >
              <span className="i-ph:arrow-counter-clockwise text-[12px]" />
              Reset
            </button>
          </div>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto modern-scrollbar px-4 py-3 space-y-4">
            {/* Palette — compact swatch grid */}
            <div>
              <div className="flex items-center gap-1.5 mb-2.5">
                <span className="i-ph:swatches text-[13px] text-palmkit-elements-textSecondary" />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-palmkit-elements-textTertiary">
                  Palette
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {paletteRoles.map((role) => {
                  const isEditing = editingColor === role.key;
                  return (
                    <div key={role.key} className="relative">
                      <button
                        type="button"
                        onClick={() => setEditingColor(isEditing ? null : role.key)}
                        title={`${role.label} — ${role.description}`}
                        className={classNames(
                          'w-full flex flex-col items-center gap-1 p-2 rounded-lg border transition-all',
                          isEditing
                            ? 'border-[var(--pk-glass-border-hi)] bg-palmkit-elements-item-backgroundActive'
                            : 'border-palmkit-elements-borderColor hover:border-[var(--pk-glass-border-hi)]',
                        )}
                      >
                        <span
                          className="w-7 h-7 rounded-full ring-1 ring-black/10 dark:ring-white/10"
                          style={{ backgroundColor: palette[role.key] }}
                        />
                        <span className="text-[10px] font-medium text-palmkit-elements-textSecondary truncate w-full text-center">
                          {role.label}
                        </span>
                      </button>

                      {isEditing && (
                        <div className="absolute z-10 top-full left-1/2 -translate-x-1/2 mt-1 p-2 rounded-lg border border-palmkit-elements-borderColor bg-palmkit-elements-background-depth-1 shadow-xl">
                          <div className="flex items-center gap-2">
                            <input
                              type="color"
                              value={palette[role.key]}
                              onChange={(e) => handleColorChange(role.key, e.target.value)}
                              className="w-8 h-8 rounded cursor-pointer border-0 p-0 bg-transparent"
                            />
                            <input
                              type="text"
                              value={palette[role.key]}
                              onChange={(e) => handleColorChange(role.key, e.target.value)}
                              className="w-20 text-[11px] font-mono px-1.5 py-1 rounded border border-palmkit-elements-borderColor bg-palmkit-elements-background-depth-2 text-palmkit-elements-textPrimary focus:outline-none focus:border-[var(--pk-glass-border-hi)]"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Typography — horizontal font chips */}
            <div>
              <div className="flex items-center gap-1.5 mb-2.5">
                <span className="i-ph:text-aa text-[13px] text-palmkit-elements-textSecondary" />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-palmkit-elements-textTertiary">
                  Typography
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {designFonts.map((f) => {
                  const isOn = font.includes(f.key);
                  return (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => handleFontToggle(f.key)}
                      className={classNames(
                        'px-2.5 py-1.5 rounded-lg text-[12px] border transition-all active:scale-95',
                        isOn
                          ? 'bg-[var(--pk-accent-dim)] text-palmkit-elements-textPrimary border-[var(--pk-glass-border-hi)]'
                          : 'bg-palmkit-elements-background-depth-1 text-palmkit-elements-textTertiary border-palmkit-elements-borderColor hover:text-palmkit-elements-textPrimary',
                      )}
                      style={{ fontFamily: f.key }}
                    >
                      {f.preview} {f.label}
                      {isOn && <span className="i-ph:check text-[10px] ml-1 inline" />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Features — toggle chips */}
            <div>
              <div className="flex items-center gap-1.5 mb-2.5">
                <span className="i-ph:magic-wand text-[13px] text-palmkit-elements-textSecondary" />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-palmkit-elements-textTertiary">
                  Features
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {designFeatures.map((f) => {
                  const isOn = features.includes(f.key);
                  return (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => handleFeatureToggle(f.key)}
                      className={classNames(
                        'px-2.5 py-1.5 rounded-lg text-[12px] font-medium border transition-all active:scale-95',
                        isOn
                          ? 'bg-[var(--pk-accent-dim)] text-palmkit-elements-textPrimary border-[var(--pk-glass-border-hi)]'
                          : 'bg-palmkit-elements-background-depth-1 text-palmkit-elements-textTertiary border-palmkit-elements-borderColor hover:text-palmkit-elements-textPrimary',
                      )}
                    >
                      {isOn && <span className="i-ph:check text-[10px] mr-1 inline" />}
                      {f.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-palmkit-elements-borderColor/70">
            <span className="text-[10px] text-palmkit-elements-textTertiary">
              {font.length + features.length} active
            </span>
            <button
              onClick={handleSave}
              className="px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-[var(--pk-accent)] text-[var(--pk-on-accent)] hover:opacity-90 active:scale-95 transition"
            >
              Apply
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};
