import React from 'react';
import * as Popover from '@radix-ui/react-popover';
import * as Tooltip from '@radix-ui/react-tooltip';
import { useStore } from '@nanostores/react';
import { classNames } from '~/utils/classNames';
import { EFFORT_LEVELS, effortAvailable } from '~/lib/modules/llm/effort';
import { descriptorKey, descriptorsStore, effortStore, setEffort } from '~/lib/stores/model-capabilities';
import { enabledSkillsStore } from '~/lib/stores/skills';
import { enabledLibrariesStore } from '~/lib/stores/libraries';
import { SkillsDialog } from './SkillsDialog';
import { AgentsDialog, LibrariesDialog, WorkflowsDialog, ConnectorsDialog, TemplatesDialog } from './BuilderPanels';

/**
 * ThinkingMeter — how hard the model should think.
 *
 * Three steps, and the middle one is the default AND the quiet one: Balanced
 * sends no parameter at all, so the model behaves exactly as its provider
 * tuned it and the bill holds no surprises. Only Fast and Deep ask for
 * anything.
 *
 * The control disables itself, with a reason, on a model that cannot be
 * steered. Its predecessor was always enabled and, in chat, wired to nothing:
 * the value it set was shipped to the build worker and never reached the chat
 * call, so pressing it changed nothing at all.
 */
export function ThinkingMeter({ provider, model }: { provider?: string; model?: string }) {
  const effort = useStore(effortStore);
  const descriptors = useStore(descriptorsStore);

  const descriptor = provider && model ? descriptors[descriptorKey(provider, model)] : undefined;
  const available = provider ? effortAvailable(provider, descriptor) : false;

  const activeIndex = EFFORT_LEVELS.findIndex((l) => l.value === effort);
  const current = EFFORT_LEVELS[activeIndex] ?? EFFORT_LEVELS[1];

  /* Bars light up to the chosen level; Fast lights one, Deep lights all three. */
  const litOpacity = effort === 'deep' ? 1 : effort === 'balanced' ? 0.7 : 0.45;

  return (
    <Tooltip.Provider delayDuration={150}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <div
            role="group"
            aria-label={`Thinking: ${current.label}`}
            aria-disabled={!available}
            className={classNames(
              'shrink-0 flex items-center gap-1.5 h-7 pl-2 pr-2.5 rounded-full border transition-colors',
              available
                ? 'border-palmkit-elements-borderColor hover:border-[var(--pk-glass-border-hi)]'
                : 'border-palmkit-elements-borderColor/50 opacity-45',
            )}
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
              tabIndex={available ? 0 : -1}
              onKeyDown={(e) => {
                if (!available) {
                  return;
                }

                if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
                  setEffort(EFFORT_LEVELS[Math.min(activeIndex + 1, 2)].value);
                } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
                  setEffort(EFFORT_LEVELS[Math.max(activeIndex - 1, 0)].value);
                }
              }}
              className={classNames(
                'flex items-end gap-[3px] h-3.5 outline-none',
                available ? 'cursor-pointer' : 'cursor-not-allowed',
              )}
            >
              {EFFORT_LEVELS.map((level, i) => {
                const lit = i <= activeIndex;
                const heights = ['h-1.5', 'h-2.5', 'h-3.5'];

                return (
                  <span
                    key={level.value}
                    role="button"
                    aria-label={level.label}
                    title={level.label}
                    onClick={() => available && setEffort(level.value)}
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
            className="z-[9999] max-w-[240px] rounded-lg border border-palmkit-elements-borderColor bg-palmkit-elements-background-depth-2 px-3 py-2 text-xs shadow-lg"
          >
            {available ? (
              <>
                <div className="font-semibold text-palmkit-elements-textPrimary">Thinking · {current.label}</div>
                <div className="mt-0.5 text-palmkit-elements-textTertiary">{current.hint}</div>
              </>
            ) : (
              <>
                <div className="font-semibold text-palmkit-elements-textPrimary">Thinking not adjustable</div>
                <div className="mt-0.5 text-palmkit-elements-textTertiary">
                  {model
                    ? `${model} does not take a thinking setting — it answers the same either way.`
                    : 'Pick a model first.'}
                </div>
              </>
            )}
            <Tooltip.Arrow className="fill-palmkit-elements-background-depth-2" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

/*
 * A clean list row in the "+" menu — real icon, label, optional chevron/badge.
 * Matches the Le Chat pattern: icon · label · (count) · chevron.
 */
function MenuRow({
  icon,
  label,
  chevron,
  count,
  href,
  onClick,
}: {
  icon: string;
  label: string;
  chevron?: boolean;
  count?: number;
  href?: string;
  onClick?: () => void;
}) {
  const inner = (
    <>
      <span className={classNames(icon, 'shrink-0 text-[19px] text-palmkit-elements-textSecondary')} />
      <span className="flex-1 text-[14px] font-medium text-palmkit-elements-textPrimary">{label}</span>
      {typeof count === 'number' && count > 0 && (
        <span className="rounded-full bg-[var(--pk-accent-dim)] px-1.5 text-[10px] font-semibold text-[var(--pk-accent)]">
          {count}
        </span>
      )}
      {chevron && <span className="i-ph:caret-right shrink-0 text-xs text-palmkit-elements-textTertiary" />}
    </>
  );
  const cls =
    'flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors hover:bg-palmkit-elements-item-backgroundActive';

  return href ? (
    <a href={href} className={cls}>
      {inner}
    </a>
  ) : (
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
  const [skillsOpen, setSkillsOpen] = React.useState(false);
  const [agentsOpen, setAgentsOpen] = React.useState(false);
  const [workflowsOpen, setWorkflowsOpen] = React.useState(false);
  const [librariesOpen, setLibrariesOpen] = React.useState(false);
  const [connectorsOpen, setConnectorsOpen] = React.useState(false);
  const [templatesOpen, setTemplatesOpen] = React.useState(false);
  const enabledSkills = useStore(enabledSkillsStore);
  const enabledLibraries = useStore(enabledLibrariesStore);

  const openPanel = (setter: (v: boolean) => void) => () => {
    setOpen(false);
    setter(true);
  };

  const resetInput = () => {
    setOpen(false);

    const ta = document.querySelector('textarea');

    if (ta) {
      const setValue = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
      setValue?.call(ta, '');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
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
          align="end"
          sideOffset={12}
          collisionPadding={8}
          className={classNames(
            'pk-no-fullscreen z-[9999] w-[calc(100vw-16px)] sm:w-[300px] max-h-[76vh] overflow-y-auto',
            'rounded-2xl border border-palmkit-elements-borderColor bg-palmkit-elements-background-depth-2 p-1.5 shadow-2xl',
          )}
          style={{ animation: 'pk-menu-in 0.16s cubic-bezier(0.16, 1, 0.3, 1)', transformOrigin: 'bottom center' }}
        >
          <style>
            {'@keyframes pk-menu-in{from{opacity:0;transform:translateY(6px) scale(0.98)}to{opacity:1;transform:none}}'}
          </style>

          {/* Clean vertical list — one real icon per row, chevron when the row
              opens a sub-panel (Le Chat pattern). */}
          <MenuRow
            icon="i-ph:upload-simple"
            label="Upload files"
            onClick={() => {
              setOpen(false);
              onAttach();
            }}
          />

          <div className="my-1 h-px bg-palmkit-elements-borderColor/70" />

          <MenuRow
            icon="i-ph:sparkle"
            label="Skills"
            chevron
            count={enabledSkills.length}
            onClick={openPanel(setSkillsOpen)}
          />
          <MenuRow icon="i-ph:robot" label="Agents" chevron onClick={openPanel(setAgentsOpen)} />
          <MenuRow icon="i-ph:flow-arrow" label="Workflows" chevron onClick={openPanel(setWorkflowsOpen)} />
          <MenuRow
            icon="i-ph:books"
            label="Libraries"
            chevron
            count={enabledLibraries.length}
            onClick={openPanel(setLibrariesOpen)}
          />
          <MenuRow icon="i-ph:plugs-connected" label="Connectors" chevron onClick={openPanel(setConnectorsOpen)} />
          <MenuRow icon="i-ph:folder" label="Projects" chevron href="/builds" />
          <MenuRow icon="i-ph:stack" label="Templates" chevron onClick={openPanel(setTemplatesOpen)} />

          <div className="my-1 h-px bg-palmkit-elements-borderColor/70" />

          <MenuRow icon="i-ph:arrow-counter-clockwise" label="Reset input" onClick={resetInput} />
        </Popover.Content>
      </Popover.Portal>
      <SkillsDialog open={skillsOpen} onOpenChange={setSkillsOpen} />
      <AgentsDialog open={agentsOpen} onOpenChange={setAgentsOpen} />
      <WorkflowsDialog open={workflowsOpen} onOpenChange={setWorkflowsOpen} />
      <LibrariesDialog open={librariesOpen} onOpenChange={setLibrariesOpen} />
      <ConnectorsDialog open={connectorsOpen} onOpenChange={setConnectorsOpen} tools={tools} />
      <TemplatesDialog open={templatesOpen} onOpenChange={setTemplatesOpen} />
    </Popover.Root>
  );
}
