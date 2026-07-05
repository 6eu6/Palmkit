import React from 'react';
import * as Popover from '@radix-ui/react-popover';
import * as Tooltip from '@radix-ui/react-tooltip';
import { useStore } from '@nanostores/react';
import { classNames } from '~/utils/classNames';
import { STARTER_TEMPLATES } from '~/utils/constants';
import { reasoningEffortStore, setReasoningEffort, REASONING_LEVELS } from '~/lib/stores/model-roles';
import { enabledSkillsStore } from '~/lib/stores/skills';
import { enabledLibrariesStore } from '~/lib/stores/libraries';
import { SkillsDialog } from './SkillsDialog';
import { AgentsDialog, LibrariesDialog, WorkflowsDialog } from './BuilderPanels';

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

/* A tappable tile in the "+" menu build-surfaces grid. */
function MenuTile({
  icon,
  label,
  hint,
  active,
  onClick,
}: {
  icon: string;
  label: string;
  hint?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col gap-2 rounded-xl border border-palmkit-elements-borderColor bg-palmkit-elements-background-depth-1 p-3 text-left transition-all hover:border-[var(--pk-glass-border-hi)] hover:bg-palmkit-elements-item-backgroundActive active:scale-[.98]"
    >
      <span className="flex items-center justify-between">
        <span className={classNames(icon, 'text-[19px] text-palmkit-elements-textSecondary')} />
        {active && <span className="h-1.5 w-1.5 rounded-full bg-[var(--pk-accent)]" />}
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold text-palmkit-elements-textPrimary">{label}</span>
        {hint && <span className="block truncate text-[10px] text-palmkit-elements-textTertiary">{hint}</span>}
      </span>
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
  const enabledSkills = useStore(enabledSkillsStore);
  const enabledLibraries = useStore(enabledLibrariesStore);

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
            'z-[9999] w-[calc(100vw-16px)] sm:w-[360px] max-h-[76vh] overflow-y-auto',
            'rounded-2xl border border-palmkit-elements-borderColor bg-palmkit-elements-background-depth-2 p-3 shadow-2xl',
          )}
          style={{ animation: 'pk-menu-in 0.16s cubic-bezier(0.16, 1, 0.3, 1)', transformOrigin: 'bottom center' }}
        >
          <style>
            {'@keyframes pk-menu-in{from{opacity:0;transform:translateY(6px) scale(0.98)}to{opacity:1;transform:none}}'}
          </style>
          {/* Build surfaces — a clean 2-up tile grid. */}
          <div className="grid grid-cols-2 gap-2">
            <MenuTile
              icon="i-ph:sparkle"
              label="Skills"
              hint={enabledSkills.length > 0 ? `${enabledSkills.length} active` : 'House rules'}
              active={enabledSkills.length > 0}
              onClick={() => {
                setOpen(false);
                setSkillsOpen(true);
              }}
            />
            <MenuTile
              icon="i-ph:robot"
              label="Agents"
              hint="Build pipeline"
              onClick={() => {
                setOpen(false);
                setAgentsOpen(true);
              }}
            />
            <MenuTile
              icon="i-ph:flow-arrow"
              label="Workflows"
              hint="One-tap presets"
              onClick={() => {
                setOpen(false);
                setWorkflowsOpen(true);
              }}
            />
            <MenuTile
              icon="i-ph:books"
              label="Libraries"
              hint={enabledLibraries.length > 0 ? `${enabledLibraries.length} active` : 'Reusable refs'}
              active={enabledLibraries.length > 0}
              onClick={() => {
                setOpen(false);
                setLibrariesOpen(true);
              }}
            />
          </div>

          {/* Projects — full-width row. */}
          <a
            href="/builds"
            className="mt-2 flex items-center gap-2.5 rounded-xl border border-palmkit-elements-borderColor px-3 py-2.5 transition-colors hover:bg-palmkit-elements-item-backgroundActive"
          >
            <span className="i-ph:folders text-[17px] text-palmkit-elements-textSecondary" />
            <span className="flex-1 text-[13px] font-medium text-palmkit-elements-textPrimary">Projects</span>
            <span className="i-ph:caret-right text-xs text-palmkit-elements-textTertiary" />
          </a>

          {/* Tools — attach + the existing tool components, one tidy row. */}
          <div className="mt-3 px-0.5 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-palmkit-elements-textTertiary">
            Tools
          </div>
          <div className="flex items-center gap-1 rounded-xl border border-palmkit-elements-borderColor p-1">
            <button
              type="button"
              title="Attach image"
              aria-label="Attach image"
              onClick={() => {
                setOpen(false);
                onAttach();
              }}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-palmkit-elements-textTertiary transition-colors hover:bg-palmkit-elements-item-backgroundActive hover:text-palmkit-elements-textPrimary"
            >
              <div className="i-ph:paperclip text-[18px]" />
            </button>
            {tools}
          </div>

          {/* Templates — a single horizontal strip so it never wraps into a mess. */}
          <div className="mt-3 px-0.5 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-palmkit-elements-textTertiary">
            Start from a stack
          </div>
          <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
            {STARTER_TEMPLATES.map((template) => (
              <a
                key={template.name}
                href={`/git?url=https://github.com/${template.githubRepo}.git`}
                title={template.label}
                className="group flex w-[60px] shrink-0 flex-col items-center gap-1 rounded-xl px-1 py-2 transition-colors hover:bg-palmkit-elements-item-backgroundActive"
              >
                <span className={classNames(template.icon, 'h-7 w-7 text-3xl opacity-80 group-hover:opacity-100')} />
                <span className="w-full truncate text-center text-[9px] text-palmkit-elements-textTertiary">
                  {template.label}
                </span>
              </a>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
      <SkillsDialog open={skillsOpen} onOpenChange={setSkillsOpen} />
      <AgentsDialog open={agentsOpen} onOpenChange={setAgentsOpen} />
      <WorkflowsDialog open={workflowsOpen} onOpenChange={setWorkflowsOpen} />
      <LibrariesDialog open={librariesOpen} onOpenChange={setLibrariesOpen} />
    </Popover.Root>
  );
}
