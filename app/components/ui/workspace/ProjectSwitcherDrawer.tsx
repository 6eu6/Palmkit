import { memo, useCallback, useEffect, useState } from 'react';
import { useNavigate } from '@remix-run/react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'react-toastify';
import { db, getAll, deleteById, getSnapshot, type ChatHistoryItem } from '~/lib/persistence';
import { chatId } from '~/lib/persistence';
import { binDates } from '~/components/sidebar/date-binning';
import { classNames } from '~/utils/classNames';
import { useStore } from '@nanostores/react';
import { sidebarModeStore, setSidebarMode, SIDEBAR_QUICK_ACTIONS, type SidebarMode } from '~/lib/stores/sidebar';
import { profileStore } from '~/lib/stores/profile';
import { authUserStore } from '~/lib/stores/auth';

/**
 * ProjectSwitcherDrawer
 *
 * Premium mobile project list drawer with dark developer-tool aesthetic.
 * - Animated gradient accent line at top
 * - New Project button with full gradient
 * - Date-binned project list with status badges
 * - Mobile-friendly delete (visible on press)
 * - Safe-area support
 *
 * Usage:
 *   <ProjectSwitcherDrawer open={open} onClose={onClose} />
 */

type ProjectStatus = 'saved' | 'generating' | 'interrupted';

interface ProjectItem extends ChatHistoryItem {
  status: ProjectStatus;
}

interface ProjectSwitcherDrawerProps {
  open: boolean;
  onClose: () => void;
}

/*
 * Slide in from the LEFT as a side drawer (standard mobile navigation
 * pattern). It previously rose from the bottom of the screen like an action
 * sheet, which read as broken for a hamburger-triggered history menu.
 */
const DRAWER_VARIANTS = {
  hidden: { x: '-100%' },
  visible: { x: 0 },
  exit: { x: '-100%' },
};

const OVERLAY_VARIANTS = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
};

export const ProjectSwitcherDrawer = memo(({ open, onClose }: ProjectSwitcherDrawerProps) => {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const mode = useStore(sidebarModeStore);
  const profile = useStore(profileStore);
  const authUser = useStore(authUserStore);

  const displayName = profile?.username || authUser?.email?.split('@')[0] || 'Account';
  const initials = displayName.slice(0, 2).toUpperCase();

  const loadProjects = useCallback(async () => {
    if (!db) {
      return;
    }

    try {
      const dbInstance = db;
      const chats = await getAll(dbInstance);
      const withStatus: ProjectItem[] = await Promise.all(
        chats
          .filter((item) => item.urlId && item.description)
          .map(async (item) => {
            let status: ProjectStatus = 'saved';

            try {
              const snapshot = await getSnapshot(dbInstance, item.id);

              if (snapshot && snapshot.files && Object.keys(snapshot.files).length > 0) {
                const lastMsg = item.messages[item.messages.length - 1];

                if (lastMsg?.role === 'assistant' && lastMsg.content) {
                  const hasArtifact = lastMsg.content.includes('<palmkitArtifact');
                  const hasClose = lastMsg.content.includes('</palmkitArtifact>');

                  if (hasArtifact && !hasClose) {
                    status = 'interrupted';
                  }
                }
              }
            } catch {
              // ignore snapshot errors
            }

            return { ...item, status };
          }),
      );

      withStatus.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setProjects(withStatus);
    } catch (error) {
      toast.error('Failed to load projects');
      console.error(error);
    }
  }, []);

  useEffect(() => {
    if (open) {
      loadProjects();
    }
  }, [open, loadProjects]);

  // Escape closes the drawer (it used to trap the user until they found the X).
  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', onKey);

    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const handleOpenProject = (item: ChatHistoryItem) => {
    const targetUrl = item.urlId ? `/chat/${item.urlId}` : `/chat/${item.id}`;
    navigate(targetUrl);
    onClose();
  };

  const handleDeleteProject = async (event: React.UIEvent, item: ChatHistoryItem) => {
    event.stopPropagation();

    if (!db) {
      return;
    }

    try {
      await deleteById(db, item.id);

      if (chatId.get() === item.id) {
        window.location.pathname = '/';
      } else {
        loadProjects();
        toast.success('Project deleted');
      }
    } catch (error) {
      toast.error('Failed to delete project');
      console.error(error);
    }
  };

  const handleNewProject = () => {
    navigate('/');
    onClose();
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) {
      return 'Just now';
    }

    if (diffMins < 60) {
      return `${diffMins}m ago`;
    }

    if (diffHours < 24) {
      return `${diffHours}h ago`;
    }

    if (diffDays < 7) {
      return `${diffDays}d ago`;
    }

    return date.toLocaleDateString();
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 z-[998] bg-black/60 backdrop-blur-sm"
            variants={OVERLAY_VARIANTS}
            initial="hidden"
            animate="visible"
            exit="exit"
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />

          {/* Drawer — left side panel, themed with the same classes as the desktop sidebar */}
          <motion.div
            className={classNames(
              'fixed left-0 top-0 bottom-0 z-[999] flex flex-col w-[85%] max-w-[340px]',
              'bg-white dark:bg-black border-r border-gray-200 dark:border-neutral-800',
              'rounded-r-2xl shadow-2xl',
            )}
            style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
            variants={DRAWER_VARIANTS}
            initial="hidden"
            animate="visible"
            exit="exit"
            transition={{ type: 'spring', damping: 32, stiffness: 320 }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={{ left: 0.9, right: 0 }}
            onDragEnd={(_e, info) => {
              /*
               * Design v2 touch spec: the panel follows the finger; a swipe
               * past 35% width OR a fast fling (>0.5 px/ms) closes it.
               */
              if (info.offset.x < -110 || info.velocity.x < -500) {
                onClose();
              }
            }}
          >
            {/* Brand + close */}
            <div className="flex items-center justify-between px-4 pt-4 pb-3">
              <img src="/palmkit-logo-light.png" alt="Palmkit" className="h-6 w-auto select-none dark:hidden" />
              <img src="/palmkit-logo-dark.png" alt="Palmkit" className="hidden h-6 w-auto select-none dark:block" />
              <button
                onClick={onClose}
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-full text-gray-400 transition active:scale-95 hover:text-gray-900 dark:hover:text-white"
              >
                <div className="i-ph:x text-base" />
              </button>
            </div>

            {/* Chat / Work / Code segmented control */}
            <div className="px-4">
              <div className="flex gap-1 rounded-xl bg-gray-100 p-1 dark:bg-neutral-900">
                {(['chat', 'work', 'code'] as SidebarMode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => setSidebarMode(m)}
                    className={classNames(
                      'flex-1 rounded-lg py-1.5 text-[13px] font-semibold capitalize transition-all',
                      mode === m
                        ? 'bg-white text-gray-900 shadow-sm dark:bg-neutral-800 dark:text-white'
                        : 'text-gray-400 dark:text-gray-500',
                    )}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="space-y-0.5 px-3 pt-3">
              <button
                onClick={handleNewProject}
                className="flex w-full items-center gap-3 rounded-xl bg-gray-50 px-3 py-2.5 text-[14px] font-medium text-gray-900 transition active:bg-gray-100 dark:bg-neutral-900 dark:text-white dark:active:bg-neutral-800"
              >
                <span className="i-ph:plus-circle text-lg text-gray-500 dark:text-gray-400" />
                {mode === 'code' ? 'New Session' : 'New Chat'}
              </button>
              {SIDEBAR_QUICK_ACTIONS[mode].map((a) =>
                a.href ? (
                  <a
                    key={a.label}
                    href={a.href}
                    onClick={onClose}
                    className="flex items-center gap-3 rounded-xl px-3 py-2 text-[14px] text-gray-700 transition active:bg-gray-50 dark:text-gray-300 dark:active:bg-neutral-900"
                  >
                    <span className={classNames(a.icon, 'text-lg text-gray-400 dark:text-gray-500')} />
                    {a.label}
                  </a>
                ) : (
                  <button
                    key={a.label}
                    onClick={() => toast.info(`${a.label} — coming soon`)}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[14px] text-gray-700 transition active:bg-gray-50 dark:text-gray-300 dark:active:bg-neutral-900"
                  >
                    <span className={classNames(a.icon, 'text-lg text-gray-400 dark:text-gray-500')} />
                    <span className="flex-1">{a.label}</span>
                    <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:bg-neutral-800 dark:text-gray-500">
                      Soon
                    </span>
                  </button>
                ),
              )}
            </div>

            {/* Recent list */}
            <div className="mt-1 flex-1 overflow-y-auto overscroll-contain px-3 pb-2">
              {projects.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-600">
                  <div className="i-ph:chats-circle mb-3 text-4xl opacity-40" />
                  <p className="text-sm">Nothing here yet</p>
                </div>
              ) : (
                binDates(projects).map(({ category, items }) => (
                  <div key={category} className="mb-1">
                    <div className="px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-600">
                      {category}
                    </div>
                    {(items as ProjectItem[]).map((item) => (
                      <div key={item.id} className="group relative">
                        <button
                          onClick={() => handleOpenProject(item)}
                          className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition active:bg-gray-50 dark:active:bg-neutral-900"
                        >
                          <span
                            className={classNames(
                              'h-1.5 w-1.5 shrink-0 rounded-full',
                              item.status === 'generating'
                                ? 'animate-pulse bg-blue-400'
                                : item.status === 'interrupted'
                                  ? 'bg-amber-400'
                                  : 'bg-gray-300 dark:bg-gray-600',
                            )}
                          />
                          <span className="min-w-0 flex-1 truncate text-[14px] text-palmkit-elements-textPrimary">
                            {item.description || 'Untitled'}
                          </span>
                          <span className="shrink-0 text-[11px] text-palmkit-elements-textTertiary">
                            {formatTime(item.timestamp)}
                          </span>
                        </button>
                        <button
                          onClick={(e) => handleDeleteProject(e, item)}
                          title="Delete"
                          className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-gray-300 opacity-0 transition hover:text-red-500 group-active:opacity-100 dark:text-gray-600"
                        >
                          <div className="i-ph:trash text-sm" />
                        </button>
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>

            {/* Profile footer */}
            <div className="mt-auto border-t border-gray-100 px-3 py-3 dark:border-neutral-800">
              <button className="flex w-full items-center gap-3 rounded-xl px-2 py-1.5 transition active:bg-gray-50 dark:active:bg-neutral-900">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-[13px] font-semibold text-gray-700 dark:bg-neutral-800 dark:text-gray-200">
                  {initials}
                </span>
                <span className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-[14px] font-medium text-gray-900 dark:text-white">
                    {displayName}
                  </span>
                  <span className="block text-[11px] text-gray-400 dark:text-gray-600">Free</span>
                </span>
                <span className="i-ph:caret-up-down text-gray-400 dark:text-gray-600" />
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
});

ProjectSwitcherDrawer.displayName = 'ProjectSwitcherDrawer';
