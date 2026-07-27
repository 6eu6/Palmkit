import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useStore } from '@nanostores/react';
import { toast } from 'react-toastify';
import { classNames } from '~/utils/classNames';
import { OPTIONAL_AGENTS, agentConfigStore, toggleAgent } from '~/lib/stores/agents';
import {
  librariesStore,
  enabledLibrariesStore,
  toggleLibrary,
  addLibraryItem,
  removeLibraryItem,
} from '~/lib/stores/libraries';
import { BUILTIN_WORKFLOWS, activeWorkflowStore, applyWorkflow } from '~/lib/stores/workflows';
import { STARTER_TEMPLATES } from '~/utils/constants';

/* Shared shell so the three panels look identical to SkillsDialog. */
function PanelShell({
  open,
  onOpenChange,
  title,
  subtitle,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[9998] bg-black/60 backdrop-blur-sm" />
        <Dialog.Content className="pk-no-fullscreen fixed left-1/2 top-1/2 z-[9999] flex max-h-[85vh] w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-palmkit-elements-borderColor bg-palmkit-elements-background-depth-2 shadow-2xl">
          <div className="flex items-center justify-between border-b border-palmkit-elements-borderColor px-4 py-3">
            <div>
              <Dialog.Title className="text-sm font-semibold text-palmkit-elements-textPrimary">{title}</Dialog.Title>
              <Dialog.Description className="text-[11px] text-palmkit-elements-textTertiary">
                {subtitle}
              </Dialog.Description>
            </div>
            <Dialog.Close className="flex h-7 w-7 items-center justify-center rounded-lg text-palmkit-elements-textTertiary transition-colors hover:bg-palmkit-elements-item-backgroundActive hover:text-palmkit-elements-textPrimary">
              <div className="i-ph:x text-base" />
            </Dialog.Close>
          </div>
          <div className="flex-1 overflow-y-auto p-2">{children}</div>
          {footer && <div className="border-t border-palmkit-elements-borderColor p-2">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      className={classNames(
        'relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors',
        on ? 'bg-[var(--pk-accent)]' : 'bg-palmkit-elements-background-depth-3',
      )}
    >
      <span
        className={classNames('absolute top-0.5 h-4 w-4 rounded-full transition-all', on ? 'left-[18px]' : 'left-0.5')}
        style={{ background: on ? 'var(--pk-on-accent)' : '#fff' }}
      />
    </button>
  );
}

/* ---------- Agents ---------- */
export function AgentsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const cfg = useStore(agentConfigStore);

  return (
    <PanelShell open={open} onOpenChange={onOpenChange} title="Agents" subtitle="Tune the build pipeline">
      <div className="mb-1 flex items-center gap-3 rounded-xl px-2.5 py-2.5 opacity-70">
        <span className="i-ph:brain mt-0.5 shrink-0 text-lg text-palmkit-elements-textSecondary" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-palmkit-elements-textPrimary">Planner + Builder</div>
          <p className="text-[11px] text-palmkit-elements-textTertiary">Core agents — always on</p>
        </div>
        <span className="rounded-full bg-palmkit-elements-background-depth-3 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-palmkit-elements-textTertiary">
          Core
        </span>
      </div>
      {OPTIONAL_AGENTS.map((a) => (
        <div
          key={a.id}
          className="flex items-start gap-3 rounded-xl px-2.5 py-2.5 transition-colors hover:bg-palmkit-elements-item-backgroundActive"
        >
          <span className={classNames(a.icon, 'mt-0.5 shrink-0 text-lg text-palmkit-elements-textSecondary')} />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-palmkit-elements-textPrimary">{a.name}</div>
            <p className="text-[11px] text-palmkit-elements-textTertiary">{a.description}</p>
          </div>
          <Toggle on={cfg[a.id]} onClick={() => toggleAgent(a.id)} label={`Toggle ${a.name}`} />
        </div>
      ))}
    </PanelShell>
  );
}

/* ---------- Libraries ---------- */
export function LibrariesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const items = useStore(librariesStore);
  const enabled = useStore(enabledLibrariesStore);
  const [adding, setAdding] = React.useState(false);
  const [name, setName] = React.useState('');
  const [kind, setKind] = React.useState('snippet');
  const [content, setContent] = React.useState('');

  const submit = () => {
    if (!name.trim() || !content.trim()) {
      return;
    }

    const id = addLibraryItem({ name: name.trim(), kind: kind.trim() || 'ref', content: content.trim() });
    toggleLibrary(id);
    setName('');
    setContent('');
    setAdding(false);
  };

  return (
    <PanelShell
      open={open}
      onOpenChange={onOpenChange}
      title="Libraries"
      subtitle="Reusable reference the Builder can draw on"
      footer={
        adding ? (
          <div className="space-y-2 p-1">
            <div className="flex gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name"
                className="min-w-0 flex-1 rounded-lg border border-palmkit-elements-borderColor bg-palmkit-elements-background-depth-1 px-3 py-2 text-[13px] text-palmkit-elements-textPrimary outline-none focus:border-[var(--pk-accent)]"
              />
              <input
                value={kind}
                onChange={(e) => setKind(e.target.value)}
                placeholder="kind"
                className="w-24 rounded-lg border border-palmkit-elements-borderColor bg-palmkit-elements-background-depth-1 px-3 py-2 text-[13px] text-palmkit-elements-textPrimary outline-none focus:border-[var(--pk-accent)]"
              />
            </div>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Reference content (snippet, tokens, docs…)"
              rows={4}
              className="w-full resize-none rounded-lg border border-palmkit-elements-borderColor bg-palmkit-elements-background-depth-1 px-3 py-2 font-mono text-[12px] text-palmkit-elements-textPrimary outline-none focus:border-[var(--pk-accent)]"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setAdding(false)}
                className="rounded-lg px-3 py-1.5 text-[12px] font-medium text-palmkit-elements-textTertiary hover:text-palmkit-elements-textPrimary"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={!name.trim() || !content.trim()}
                className="rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:opacity-40"
                style={{ background: 'var(--pk-accent)', color: 'var(--pk-on-accent)' }}
              >
                Save
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-[13px] font-medium text-palmkit-elements-textSecondary transition-colors hover:bg-palmkit-elements-item-backgroundActive"
          >
            <span className="i-ph:plus text-base" />
            New library item
          </button>
        )
      }
    >
      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-palmkit-elements-textTertiary">
          <div className="i-ph:books mb-2 text-3xl opacity-40" />
          <p className="text-xs">No reference material yet</p>
        </div>
      ) : (
        items.map((item) => {
          const on = enabled.includes(item.id);

          return (
            <div
              key={item.id}
              className="group flex items-start gap-3 rounded-xl px-2.5 py-2.5 transition-colors hover:bg-palmkit-elements-item-backgroundActive"
            >
              <span className="i-ph:file-text mt-0.5 shrink-0 text-lg text-palmkit-elements-textSecondary" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium text-palmkit-elements-textPrimary">{item.name}</span>
                  <span className="rounded-full bg-palmkit-elements-background-depth-3 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-palmkit-elements-textTertiary">
                    {item.kind}
                  </span>
                  <button
                    onClick={() => removeLibraryItem(item.id)}
                    className="text-[10px] text-palmkit-elements-textTertiary opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                  >
                    Remove
                  </button>
                </div>
                <p className="truncate font-mono text-[11px] text-palmkit-elements-textTertiary">{item.content}</p>
              </div>
              <Toggle on={on} onClick={() => toggleLibrary(item.id)} label={`Toggle ${item.name}`} />
            </div>
          );
        })
      )}
    </PanelShell>
  );
}

/* ---------- Workflows ---------- */
export function WorkflowsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const active = useStore(activeWorkflowStore);

  const apply = (id: string, name: string) => {
    const scaffold = applyWorkflow(id);

    if (scaffold) {
      // Drop the scaffold into the composer (works with the controlled textarea).
      const ta = document.querySelector('textarea');

      if (ta) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
        setter?.call(ta, scaffold);
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        ta.focus();
      }
    }

    toast.success(`${name} workflow applied`);
    onOpenChange(false);
  };

  return (
    <PanelShell
      open={open}
      onOpenChange={onOpenChange}
      title="Workflows"
      subtitle="One-tap presets — skills, agents & a prompt scaffold"
    >
      {BUILTIN_WORKFLOWS.map((wf) => (
        <button
          key={wf.id}
          onClick={() => apply(wf.id, wf.name)}
          className={classNames(
            'flex w-full items-start gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors hover:bg-palmkit-elements-item-backgroundActive',
            active === wf.id && 'bg-palmkit-elements-item-backgroundActive',
          )}
        >
          <span className={classNames(wf.icon, 'mt-0.5 shrink-0 text-lg text-palmkit-elements-textSecondary')} />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-palmkit-elements-textPrimary">{wf.name}</div>
            <p className="text-[11px] text-palmkit-elements-textTertiary">{wf.description}</p>
          </div>
          <span className="i-ph:arrow-right mt-1 shrink-0 text-palmkit-elements-textTertiary" />
        </button>
      ))}
    </PanelShell>
  );
}

/* ---------- Connectors ---------- */
export function ConnectorsDialog({
  open,
  onOpenChange,
  tools,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tools: React.ReactNode;
}) {
  return (
    <PanelShell
      open={open}
      onOpenChange={onOpenChange}
      title="Connectors"
      subtitle="Tools & integrations for your builds"
    >
      <div className="px-1.5 pb-1.5 pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-palmkit-elements-textTertiary">
        Available
      </div>
      {/* The tool components render their own icon-triggers + dialogs; grouped
          here as one tidy connectors surface. */}
      <div className="flex flex-wrap items-center gap-1 rounded-xl border border-palmkit-elements-borderColor p-2">
        {tools}
      </div>
      <p className="px-1.5 pt-2 text-[11px] leading-relaxed text-palmkit-elements-textTertiary">
        Web search, design theme, MCP tools and your database connect here — tap an icon to configure it.
      </p>
    </PanelShell>
  );
}

/* ---------- Templates ---------- */
export function TemplatesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <PanelShell open={open} onOpenChange={onOpenChange} title="Templates" subtitle="Start from a ready-made stack">
      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
        {STARTER_TEMPLATES.map((template) => (
          <a
            key={template.name}
            href={`/git?url=https://github.com/${template.githubRepo}.git`}
            title={template.label}
            className="group flex flex-col items-center gap-1.5 rounded-xl border border-palmkit-elements-borderColor px-1 py-3 transition-colors hover:bg-palmkit-elements-item-backgroundActive"
          >
            <span className={classNames(template.icon, 'h-7 w-7 text-3xl opacity-80 group-hover:opacity-100')} />
            <span className="w-full truncate px-1 text-center text-[10px] text-palmkit-elements-textTertiary">
              {template.label}
            </span>
          </a>
        ))}
      </div>
    </PanelShell>
  );
}
