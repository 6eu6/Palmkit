import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from '@remix-run/react';
import { toast } from 'react-toastify';
import { db, getAll, deleteById, getSnapshot, type ChatHistoryItem } from '~/lib/persistence';
import { chatId } from '~/lib/persistence';
import { binDates } from '~/components/sidebar/date-binning';

type ProjectStatus = 'saved' | 'generating' | 'interrupted';

interface ProjectItem extends ChatHistoryItem {
  status: ProjectStatus;
}

interface ProjectListProps {
  open: boolean;
  onClose: () => void;
}

export function ProjectList({ open, onClose }: ProjectListProps) {
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
                /*
                 * If the last message is from an assistant and doesn't look complete,
                 * mark as interrupted
                 */
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

      // Sort by timestamp descending
      withStatus.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setProjects(withStatus);
    } catch (error) {
      toast.error('Failed to load projects');
      console.error(error);
    }
  }, [db]);

  useEffect(() => {
    if (open) {
      loadProjects();
    }
  }, [open, loadProjects]);

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

  const statusBadge = (status: ProjectStatus) => {
    switch (status) {
      case 'generating':
        return (
          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800/40 text-gray-700 dark:text-gray-300">
            <span className="w-1.5 h-1.5 rounded-full bg-gray-600 animate-pulse" />
            Generating
          </span>
        );
      case 'interrupted':
        return (
          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            Interrupted
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
            Saved
          </span>
        );
    }
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

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-950 rounded-xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col overflow-hidden border border-gray-200 dark:border-gray-800">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-800">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Projects</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 transition-colors"
          >
            <div className="i-ph:x text-lg" />
          </button>
        </div>

        {/* New project button */}
        <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800/50">
          <button
            onClick={handleNewProject}
            className="w-full flex items-center justify-center gap-2 bg-gray-600 hover:bg-gray-700 dark:bg-gray-600 dark:hover:bg-gray-600 text-white rounded-lg px-4 py-2.5 transition-colors font-medium text-sm"
          >
            <div className="i-ph:plus-circle text-base" />
            New Project
          </button>
        </div>

        {/* Project list */}
        <div className="flex-1 overflow-auto">
          {projects.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-500 dark:text-gray-400">
              <div className="i-ph:folder-open text-4xl mb-3 opacity-50" />
              <p className="text-sm">No projects yet</p>
              <p className="text-xs mt-1 opacity-70">Start a new project to begin</p>
            </div>
          ) : (
            <div className="py-2">
              {binDates(projects).map(({ category, items }) => (
                <div key={category}>
                  <div className="px-5 py-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 sticky top-0 bg-white dark:bg-gray-950 z-1">
                    {category}
                  </div>
                  {(items as ProjectItem[]).map((item) => (
                    <button
                      key={item.id}
                      onClick={() => handleOpenProject(item)}
                      className="w-full text-left px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-900/50 transition-colors group flex items-start gap-3"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900 dark:text-white truncate">
                          {item.description || 'Untitled Project'}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs text-gray-500 dark:text-gray-400">{formatTime(item.timestamp)}</span>
                          {statusBadge(item.status)}
                        </div>
                      </div>
                      <button
                        onClick={(e) => handleDeleteProject(e, item)}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-all shrink-0"
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
      </div>
    </div>
  );
}
