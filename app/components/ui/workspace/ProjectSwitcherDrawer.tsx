import { memo, useCallback, useEffect, useState } from 'react';
import { useNavigate } from '@remix-run/react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'react-toastify';
import { db, getAll, deleteById, getSnapshot, type ChatHistoryItem } from '~/lib/persistence';
import { chatId } from '~/lib/persistence';
import { binDates } from '~/components/sidebar/date-binning';
import { classNames } from '~/utils/classNames';

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

  const renderStatusBadge = (status: ProjectStatus) => {
    switch (status) {
      case 'generating':
        return (
          <span
            className={classNames(
              'inline-flex items-center gap-1',
              'text-[10px] px-1.5 py-0.5 rounded-full',
              'bg-[var(--palmkit-mobile-accent-muted)] text-[var(--palmkit-mobile-accent-text)]',
              'border border-[var(--palmkit-mobile-surface-border)]',
            )}
          >
            <span className="w-1 h-1 rounded-full bg-[var(--palmkit-mobile-accent)] animate-pulse" />
            Generating
          </span>
        );
      case 'interrupted':
        return (
          <span
            className={classNames(
              'inline-flex items-center gap-1',
              'text-[10px] px-1.5 py-0.5 rounded-full',
              'bg-[var(--palmkit-mobile-warning-muted)] text-[var(--palmkit-mobile-warning)]',
              'border border-[var(--palmkit-mobile-surface-border)]',
            )}
          >
            <span className="w-1 h-1 rounded-full bg-[var(--palmkit-mobile-warning)]" />
            Interrupted
          </span>
        );
      default:
        return (
          <span
            className={classNames(
              'inline-flex items-center gap-1',
              'text-[10px] px-1.5 py-0.5 rounded-full',
              'bg-[var(--palmkit-mobile-success-muted)] text-[var(--palmkit-mobile-success)]',
              'border border-[var(--palmkit-mobile-surface-border)]',
            )}
          >
            <span className="w-1 h-1 rounded-full bg-[var(--palmkit-mobile-success)]" />
            Saved
          </span>
        );
    }
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
              'bg-white dark:bg-gray-950 border-r border-gray-200 dark:border-gray-800',
              'rounded-r-2xl shadow-xl',
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
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800/50">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">Projects</h2>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg transition-colors active:scale-95 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white"
                aria-label="Close"
              >
                <div className="i-ph:x text-base" />
              </button>
            </div>

            {/* New project button */}
            <div className="px-4 py-3">
              <button
                onClick={handleNewProject}
                className={classNames(
                  'w-full flex items-center justify-center gap-2 rounded-lg px-4 py-2.5',
                  'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 font-medium text-sm',
                  'transition-all duration-200 active:scale-[0.98] hover:opacity-90',
                )}
              >
                <div className="i-ph:plus-circle text-base" />
                New Project
              </button>
            </div>

            {/* Project list */}
            <div className="flex-1 overflow-y-auto overscroll-contain">
              {projects.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-500">
                  <div className="i-ph:folder-open text-5xl mb-4 opacity-40" />
                  <p className="text-sm font-medium">No projects yet</p>
                  <p className="text-xs mt-1.5 opacity-60">Start a new project to begin</p>
                </div>
              ) : (
                <div className="pb-4">
                  {binDates(projects).map(({ category, items }) => (
                    <div key={category}>
                      <div className="px-5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 sticky top-0 bg-white dark:bg-gray-950 z-[1]">
                        {category}
                      </div>
                      {(items as ProjectItem[]).map((item) => (
                        <button
                          key={item.id}
                          onClick={() => handleOpenProject(item)}
                          className="w-full text-left px-4 py-3 transition-colors group flex items-start gap-3 hover:bg-gray-50 dark:hover:bg-gray-900 active:bg-gray-100 dark:active:bg-gray-800"
                        >
                          {/* Project icon container */}
                          <div className="w-9 h-9 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center shrink-0 mt-0.5">
                            <div className="i-ph:code text-sm text-gray-600 dark:text-gray-300" />
                          </div>

                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                              {item.description || 'Untitled Project'}
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-[10px] text-gray-500 dark:text-gray-400">
                                {formatTime(item.timestamp)}
                              </span>
                              {renderStatusBadge(item.status)}
                            </div>
                          </div>

                          {/* Delete — visible on press (mobile) and hover (desktop) */}
                          <button
                            onClick={(e) => handleDeleteProject(e, item)}
                            className={classNames(
                              'opacity-0 group-hover:opacity-100 active:opacity-100 group-active:opacity-100',
                              'p-1.5 rounded-lg shrink-0',
                              'text-gray-400 dark:text-gray-500',
                              'hover:bg-red-50 dark:hover:bg-red-950 hover:text-red-500',
                              'transition-all active:scale-95',
                            )}
                            title="Delete project"
                          >
                            <div className="i-ph:trash text-sm" />
                          </button>
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
});

ProjectSwitcherDrawer.displayName = 'ProjectSwitcherDrawer';
