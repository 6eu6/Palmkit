import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useStore } from '@nanostores/react';
import { classNames } from '~/utils/classNames';
import {
  BUILTIN_SKILLS,
  userSkillsStore,
  enabledSkillsStore,
  toggleSkill,
  addUserSkill,
  removeUserSkill,
  type Skill,
} from '~/lib/stores/skills';

/**
 * SkillsDialog — manage the reusable instruction playbooks injected into the
 * build models (v3 Phase 6). Toggle built-ins, add your own; enabled skills
 * ride along with every build.
 */
export function SkillsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const userSkills = useStore(userSkillsStore);
  const enabled = useStore(enabledSkillsStore);
  const skills: Skill[] = [...BUILTIN_SKILLS, ...userSkills];

  const [adding, setAdding] = React.useState(false);
  const [name, setName] = React.useState('');
  const [instructions, setInstructions] = React.useState('');

  const submit = () => {
    if (!name.trim() || !instructions.trim()) {
      return;
    }

    const id = addUserSkill({
      name: name.trim(),
      description: 'Custom skill',
      icon: 'i-ph:sparkle',
      instructions: instructions.trim(),
    });
    toggleSkill(id); // enable it on creation
    setName('');
    setInstructions('');
    setAdding(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[9998] bg-black/60 backdrop-blur-sm" />
        <Dialog.Content className="pk-no-fullscreen fixed left-1/2 top-1/2 z-[9999] flex max-h-[85vh] w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-palmkit-elements-borderColor bg-palmkit-elements-background-depth-2 shadow-2xl">
          <div className="flex items-center justify-between border-b border-palmkit-elements-borderColor px-4 py-3">
            <div>
              <Dialog.Title className="text-sm font-semibold text-palmkit-elements-textPrimary">Skills</Dialog.Title>
              <Dialog.Description className="text-[11px] text-palmkit-elements-textTertiary">
                Enabled skills are injected into every build
              </Dialog.Description>
            </div>
            <Dialog.Close className="flex h-7 w-7 items-center justify-center rounded-lg text-palmkit-elements-textTertiary transition-colors hover:bg-palmkit-elements-item-backgroundActive hover:text-palmkit-elements-textPrimary">
              <div className="i-ph:x text-base" />
            </Dialog.Close>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {skills.map((skill) => {
              const on = enabled.includes(skill.id);

              return (
                <div
                  key={skill.id}
                  className="group flex items-start gap-3 rounded-xl px-2.5 py-2.5 transition-colors hover:bg-palmkit-elements-item-backgroundActive"
                >
                  <span
                    className={classNames(skill.icon, 'mt-0.5 shrink-0 text-lg text-palmkit-elements-textSecondary')}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-palmkit-elements-textPrimary">{skill.name}</span>
                      {!skill.builtin && (
                        <button
                          onClick={() => removeUserSkill(skill.id)}
                          className="text-[10px] text-palmkit-elements-textTertiary opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    <p className="truncate text-[11px] text-palmkit-elements-textTertiary">{skill.description}</p>
                  </div>
                  {/* Toggle */}
                  <button
                    role="switch"
                    aria-checked={on}
                    aria-label={`${on ? 'Disable' : 'Enable'} ${skill.name}`}
                    onClick={() => toggleSkill(skill.id)}
                    className={classNames(
                      'relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors',
                      on ? 'bg-[var(--pk-accent)]' : 'bg-palmkit-elements-background-depth-3',
                    )}
                  >
                    <span
                      className={classNames(
                        'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all',
                        on ? 'left-[18px]' : 'left-0.5',
                      )}
                      style={on ? { background: 'var(--pk-on-accent)' } : undefined}
                    />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Add custom skill */}
          <div className="border-t border-palmkit-elements-borderColor p-2">
            {adding ? (
              <div className="space-y-2 p-1">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Skill name"
                  className="w-full rounded-lg border border-palmkit-elements-borderColor bg-palmkit-elements-background-depth-1 px-3 py-2 text-[13px] text-palmkit-elements-textPrimary outline-none focus:border-[var(--pk-accent)]"
                />
                <textarea
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder="Instructions the models must follow…"
                  rows={3}
                  className="w-full resize-none rounded-lg border border-palmkit-elements-borderColor bg-palmkit-elements-background-depth-1 px-3 py-2 text-[13px] text-palmkit-elements-textPrimary outline-none focus:border-[var(--pk-accent)]"
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
                    disabled={!name.trim() || !instructions.trim()}
                    className="rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:opacity-40"
                    style={{ background: 'var(--pk-accent)', color: 'var(--pk-on-accent)' }}
                  >
                    Add skill
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setAdding(true)}
                className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-[13px] font-medium text-palmkit-elements-textSecondary transition-colors hover:bg-palmkit-elements-item-backgroundActive"
              >
                <span className="i-ph:plus text-base" />
                New skill
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
