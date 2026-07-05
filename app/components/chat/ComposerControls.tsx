import React from 'react';
import * as Popover from '@radix-ui/react-popover';
import * as Tooltip from '@radix-ui/react-tooltip';
import { useStore } from '@nanostores/react';
import { toast } from 'react-toastify';
import { classNames } from '~/utils/classNames';
import { STARTER_TEMPLATES } from '~/utils/constants';
import { reasoningEffortStore, setReasoningEffort, REASONING_LEVELS } from '~/lib/stores/model-roles';

/**
 * ThinkingMeter — the "thinking power" control (v3 Phase 5).
 *
 * A three-bar volume-style meter. Each bar is taller than the last; the number
 * of lit bars and their brightness rise with the level (Off → Medium → Max),
 * so the strength reads at a glance without any label. Clicking a bar sets that
 * level directly; the whole thing is wrapped in a tooltip that names the level.
 *
 * The value is the same `reasoningEffortStore` that the build pipeline already
 * ships to the worker (`off`/`medium`/`max` → OpenRouter effort none/med/high),
 * so this is a real control, not decoration.
 */
export function ThinkingMeter() {
  const effort = useStore(reasoningEffortStore);
  const activeIndex = REASONING_LEVELS.findIndex((l) => l.value === effort);
  const current = REASONING_LEVELS[activeIndex] ?? REASONING_LEVELS[1];

  // Brightness of lit bars steps up with the level — monochrome, on v3 theme.
  const litOpacity = effort === 'max' ? 1 : effort === 'medium' ? 0.7 : 0.4;

  return (
    <Tooltip.Provider delayDuration={150}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <div
            role="group"
            aria-label={`Thinking power: ${current.label}`}
            className="shrink-0 flex items-center gap-1.5 h-7 pl-2 pr-2.5 rounded-full border border-palmkit-elements-borderColor hover:border-[var(--pk-glass-border-hi)] transition-colors"
          >
            <div className="i-ph:brain text-[13px] text-palmkit-elements-textTertiary" />
            {/*
             * Bars are <span>s, not <button>s: a global rule forces every
             * <button> to a 32px min touch-target, which would blow the thin
             * meter bars up into blobs. The parent div carries the a11y role.
             */}
            <div
              role="slider"
              aria-valuemin={0}
              aria-valuemax={2}
              aria-valuenow={Math.max(activeIndex, 0)}
              aria-valuetext={current.label}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
                  setReasoningEffort(REASONING_LEVELS[Math.min(activeIndex + 1, 2)].value);
                } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
                  setReasoningEffort(REASONING_LEVELS[Math.max(activeIndex - 1, 0)].value);
                }
              }}
              className="flex items-end gap-[3px] h-3.5 cursor-pointer outline-none"
            >
              {REASONING_LEVELS.map((level, i) => {
                const lit = i <= activeIndex && effort !== 'off';
                const heights = ['h-1.5', 'h-2.5', 'h-3.5'];

                return (
                  <span
                    key={level.value}
                    role="button"
                    aria-label={level.label}
                    title={level.label}
                    onClick={() => setReasoningEffort(level.value)}
                    className={classNames('block w-1 rounded-full transition-all duration-150', heights[i])}
                    style={{
                      backgroundColor: lit ? 'var(--pk-accent)' : 'var(--palmkit-elements-borderColor)',
                      opacity: lit ? litOpacity : 1,
                    }}
                  />
                );
              })}
            </div>
          </div>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="top"
            sideOffset={8}
            className="z-[9999] max-w-[220px] rounded-lg border border-palmkit-elements-borderColor bg-palmkit-elements-background-depth-2 px-3 py-2 text-xs shadow-lg"
          >
            <div className="font-semibold text-palmkit-elements-textPrimary">Thinking · {current.label}</div>
            <div className="mt-0.5 text-palmkit-elements-textTertiary">{current.hint}</div>
            <Tooltip.Arrow className="fill-palmkit-elements-background-depth-2" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

/* One labelled row inside the "+" menu. */
function MenuRow({
  icon,
  label,
  hint,
  soon,
  href,
  onClick,
}: {
  icon: string;
  label: string;
  hint?: string;
  soon?: boolean;
  href?: string;
  onClick?: () => void;
}) {
  const inner = (
    <>
      <span className={classNames(icon, 'text-[17px] text-palmkit-elements-textSecondary shrink-0')} />
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-palmkit-elements-textPrimary">{label}</span>
        {hint && <span className="block text-[11px] text-palmkit-elements-textTertiary truncate">{hint}</span>}
      </span>
      {soon && (
        <span className="shrink-0 rounded-full bg-palmkit-elements-background-depth-3 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-palmkit-elements-textTertiary">
          Soon
        </span>
      )}
    </>
  );

  const cls =
    'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-palmkit-elements-item-backgroundActive';

  if (href) {
    return (
      <a href={href} className={cls}>
        {inner}
      </a>
    );
  }

  return (
    <button type="button" onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}

/**
 * PlusMenu — the single "+" entry point in the composer (v3 Phase 4).
 *
 * Collapses everything that used to clutter the toolbar (attach, web search,
 * palette, connectors) plus the product surfaces the user asked for (Skills,
 * Agents, Workflows, Libraries, Projects) and the starter stack — previously a
 * loose row of tiles under the suggestions — into one clean popover.
 *
 * `tools` is the strip of existing tool components (they render their own
 * trigger buttons) so their behaviour is unchanged; only their home moved.
 */
export function PlusMenu({ onAttach, tools }: { onAttach: () => void; tools: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const soon = (label: string) => () => {
    setOpen(false);
    toast.info(`${label} — coming soon`);
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          title="Add tools & templates"
          aria-label="Add tools & templates"
          className={classNames(
            'shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-150 active:scale-90',
            open
              ? 'bg-palmkit-elements-item-backgroundActive text-palmkit-elements-textPrimary'
              : 'text-palmkit-elements-textTertiary hover:text-palmkit-elements-textPrimary hover:bg-palmkit-elements-item-backgroundActive',
          )}
        >
          <div className={classNames(open ? 'i-ph:x' : 'i-ph:plus', 'text-[18px]')} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={10}
          className="z-[9999] w-[300px] max-h-[70vh] overflow-y-auto rounded-2xl border border-palmkit-elements-borderColor bg-palmkit-elements-background-depth-2 p-2 shadow-2xl"
        >
          {/* Tools strip — the existing working tools, relocated here. */}
          <div className="px-1.5 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-palmkit-elements-textTertiary">
            Tools
          </div>
          <div className="flex items-center gap-1 px-1 pb-1">
            <button
              type="button"
              title="Attach image"
              aria-label="Attach image"
              onClick={() => {
                setOpen(false);
                onAttach();
              }}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-palmkit-elements-textTertiary hover:text-palmkit-elements-textPrimary hover:bg-palmkit-elements-item-backgroundActive transition-colors"
            >
              <div className="i-ph:paperclip text-[18px]" />
            </button>
            {tools}
          </div>

          <div className="my-1.5 h-px bg-palmkit-elements-borderColor/70" />

          {/* Product surfaces */}
          <MenuRow
            icon="i-ph:sparkle"
            label="Skills"
            hint="Reusable instructions models can invoke"
            soon
            onClick={soon('Skills')}
          />
          <MenuRow
            icon="i-ph:robot"
            label="Agents"
            hint="Custom sub-agents for your flow"
            soon
            onClick={soon('Agents')}
          />
          <MenuRow
            icon="i-ph:flow-arrow"
            label="Workflows"
            hint="Multi-step automations"
            soon
            onClick={soon('Workflows')}
          />
          <MenuRow
            icon="i-ph:books"
            label="Libraries"
            hint="Saved snippets, components & docs"
            soon
            onClick={soon('Libraries')}
          />
          <MenuRow icon="i-ph:folders" label="Projects" hint="Your builds" href="/builds" />

          <div className="my-1.5 h-px bg-palmkit-elements-borderColor/70" />

          {/* Starter stack — moved out of the loose row under the suggestions. */}
          <div className="px-1.5 pb-1.5 pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-palmkit-elements-textTertiary">
            Start from a stack
          </div>
          <div className="grid grid-cols-4 gap-1 px-1 pb-1">
            {STARTER_TEMPLATES.map((template) => (
              <a
                key={template.name}
                href={`/git?url=https://github.com/${template.githubRepo}.git`}
                title={template.label}
                className="group flex flex-col items-center gap-1 rounded-lg px-1 py-2 hover:bg-palmkit-elements-item-backgroundActive transition-colors"
              >
                <span className={classNames(template.icon, 'w-6 h-6 text-2xl opacity-80 group-hover:opacity-100')} />
                <span className="w-full truncate text-center text-[9px] text-palmkit-elements-textTertiary">
                  {template.label}
                </span>
              </a>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
