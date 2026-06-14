import ignore from 'ignore';
import { useGit } from '~/lib/hooks/useGit';
import type { Message } from 'ai';
import { detectProjectCommands, createCommandsMessage, escapeBoltTags } from '~/utils/projectCommands';
import { generateId } from '~/utils/fileUtils';
import { useState } from 'react';
import { toast } from 'react-toastify';
import { LoadingOverlay } from '~/components/ui/LoadingOverlay';
import { classNames } from '~/utils/classNames';
import { Button } from '~/components/ui/Button';
import type { IChatMetadata } from '~/lib/persistence/db';

import { GitHubRepositorySelector } from '~/components/@settings/tabs/github/components/GitHubRepositorySelector';
import { GitLabRepositorySelector } from '~/components/@settings/tabs/gitlab/components/GitLabRepositorySelector';

const IGNORE_PATTERNS = [
  'node_modules/**',
  '.git/**',
  '.github/**',
  '.vscode/**',
  'dist/**',
  'build/**',
  '.next/**',
  'coverage/**',
  '.cache/**',
  '.idea/**',
  '**/*.log',
  '**/.DS_Store',
  '**/npm-debug.log*',
  '**/yarn-debug.log*',
  '**/yarn-error.log*',
  '**/*lock.yaml',
];

const ig = ignore().add(IGNORE_PATTERNS);

const MAX_FILE_SIZE = 100 * 1024;
const MAX_TOTAL_SIZE = 500 * 1024;

interface GitCloneButtonProps {
  className?: string;
  importChat?: (description: string, messages: Message[], metadata?: IChatMetadata) => Promise<void>;
}

export default function GitCloneButton({ importChat, className }: GitCloneButtonProps) {
  const { ready, gitClone } = useGit();
  const [loading, setLoading] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<'github' | 'gitlab' | null>(null);

  const handleClone = async (repoUrl: string) => {
    if (!ready) {
      return;
    }

    setLoading(true);
    setIsDialogOpen(false);
    setSelectedProvider(null);

    try {
      const { workdir, data } = await gitClone(repoUrl);

      if (importChat) {
        const filePaths = Object.keys(data).filter((filePath) => !ig.ignores(filePath));
        const textDecoder = new TextDecoder('utf-8');

        let totalSize = 0;
        const skippedFiles: string[] = [];
        const fileContents = [];

        for (const filePath of filePaths) {
          const { data: content, encoding } = data[filePath];

          if (
            content instanceof Uint8Array &&
            !filePath.match(/\.(txt|md|astro|mjs|js|jsx|ts|tsx|json|html|css|scss|less|yml|yaml|xml|svg|vue|svelte)$/i)
          ) {
            skippedFiles.push(filePath);
            continue;
          }

          try {
            const textContent =
              encoding === 'utf8' ? content : content instanceof Uint8Array ? textDecoder.decode(content) : '';

            if (!textContent) {
              continue;
            }

            const fileSize = new TextEncoder().encode(textContent).length;

            if (fileSize > MAX_FILE_SIZE) {
              skippedFiles.push(`${filePath} (too large: ${Math.round(fileSize / 1024)}KB)`);
              continue;
            }

            if (totalSize + fileSize > MAX_TOTAL_SIZE) {
              skippedFiles.push(`${filePath} (would exceed total size limit)`);
              continue;
            }

            totalSize += fileSize;
            fileContents.push({
              path: filePath,
              content: textContent,
            });
          } catch (e: any) {
            skippedFiles.push(`${filePath} (error: ${e.message})`);
          }
        }

        const commands = await detectProjectCommands(fileContents);
        const commandsMessage = createCommandsMessage(commands);

        const filesMessage: Message = {
          role: 'assistant',
          content: `Cloning the repo ${repoUrl} into ${workdir}
${
  skippedFiles.length > 0
    ? `\nSkipped files (${skippedFiles.length}):
${skippedFiles.map((f) => `- ${f}`).join('\n')}`
    : ''
}

<boltArtifact id="imported-files" title="Git Cloned Files" type="bundled">
${fileContents
  .map(
    (file) =>
      `<boltAction type="file" filePath="${file.path}">
${escapeBoltTags(file.content)}
</boltAction>`,
  )
  .join('\n')}
</boltArtifact>`,
          id: generateId(),
          createdAt: new Date(),
        };

        const messages = [filesMessage];

        if (commandsMessage) {
          messages.push(commandsMessage);
        }

        await importChat(`Git Project:${repoUrl.split('/').slice(-1)[0]}`, messages);
      }
    } catch (error) {
      console.error('Error during import:', error);
      toast.error('Failed to import repository');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button
        onClick={() => {
          setSelectedProvider(null);
          setIsDialogOpen(true);
        }}
        title="Import from GitHub or GitLab"
        variant="default"
        size="sm"
        className={classNames(
          'gap-2 bg-bolt-elements-bg-depth-1/80',
          'text-bolt-elements-textPrimary',
          'hover:bg-bolt-elements-button-primary-background hover:text-bolt-elements-button-primary-text',
          'border border-bolt-elements-borderColor',
          'h-9 px-3 py-1.5 sm:h-10 sm:px-4 sm:py-2 sm:min-w-[140px] justify-center',
          'transition-all duration-200 ease-out',
          'backdrop-blur-sm',
          'hover:shadow-[0_0_16px_var(--bolt-glow-color)]',
          'text-xs sm:text-sm',
          className,
        )}
        disabled={!ready || loading}
      >
        <div className="i-bolt:github text-base sm:text-lg" />
        <span className="hidden sm:inline">Import from Git</span>
        <span className="sm:hidden">Git</span>
      </Button>

      {isDialogOpen && !selectedProvider && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-bolt-elements-bg-depth-1 rounded-xl shadow-xl border border-bolt-elements-borderColor max-w-md w-full">
            <div className="p-6">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-lg font-semibold text-bolt-elements-textPrimary">Import Repository</h3>
                <button
                  onClick={() => setIsDialogOpen(false)}
                  className="p-2 rounded-lg hover:bg-bolt-elements-item-backgroundActive text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary transition-all duration-200"
                >
                  <div className="i-ph:x text-lg" />
                </button>
              </div>

              <p className="text-sm text-bolt-elements-textSecondary mb-4">
                Choose a provider to clone a repository into your workspace.
              </p>

              <div className="space-y-3">
                <button
                  onClick={() => setSelectedProvider('github')}
                  className="w-full p-4 rounded-lg bg-bolt-elements-item-backgroundDefault hover:bg-bolt-elements-item-backgroundActive border border-bolt-elements-borderColor hover:border-bolt-elements-borderColorActive transition-all duration-200 text-left group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-bolt-elements-item-backgroundAccent flex items-center justify-center group-hover:bg-bolt-elements-item-backgroundActive transition-colors">
                      <div className="i-bolt:github text-[22px] text-bolt-elements-item-contentAccent" />
                    </div>
                    <div>
                      <div className="font-medium text-bolt-elements-textPrimary">GitHub</div>
                      <div className="text-sm text-bolt-elements-textSecondary">
                        Clone from your GitHub repositories
                      </div>
                    </div>
                    <div className="i-ph:caret-right ml-auto text-bolt-elements-textTertiary group-hover:text-bolt-elements-textSecondary transition-colors" />
                  </div>
                </button>

                <button
                  onClick={() => setSelectedProvider('gitlab')}
                  className="w-full p-4 rounded-lg bg-bolt-elements-item-backgroundDefault hover:bg-bolt-elements-item-backgroundActive border border-bolt-elements-borderColor hover:border-bolt-elements-borderColorActive transition-all duration-200 text-left group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-bolt-elements-item-backgroundAccent flex items-center justify-center group-hover:bg-bolt-elements-item-backgroundActive transition-colors">
                      <div className="i-bolt:gitlab text-[22px] text-bolt-elements-item-contentAccent" />
                    </div>
                    <div>
                      <div className="font-medium text-bolt-elements-textPrimary">GitLab</div>
                      <div className="text-sm text-bolt-elements-textSecondary">
                        Clone from your GitLab repositories
                      </div>
                    </div>
                    <div className="i-ph:caret-right ml-auto text-bolt-elements-textTertiary group-hover:text-bolt-elements-textSecondary transition-colors" />
                  </div>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isDialogOpen && selectedProvider === 'github' && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-bolt-elements-bg-depth-1 rounded-xl shadow-xl border border-bolt-elements-borderColor w-full max-w-4xl max-h-[90vh] overflow-hidden">
            <div className="p-5 border-b border-bolt-elements-borderColor flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-bolt-elements-item-backgroundAccent flex items-center justify-center">
                  <div className="i-bolt:github text-xl text-bolt-elements-item-contentAccent" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-bolt-elements-textPrimary">Import from GitHub</h3>
                  <p className="text-xs text-bolt-elements-textSecondary">Select a repository to clone</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setIsDialogOpen(false);
                  setSelectedProvider(null);
                }}
                className="p-2 rounded-lg hover:bg-bolt-elements-item-backgroundActive text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary transition-all duration-200"
              >
                <div className="i-ph:x text-lg" />
              </button>
            </div>

            <div className="p-5 max-h-[calc(90vh-100px)] overflow-y-auto">
              <GitHubRepositorySelector onClone={handleClone} />
            </div>
          </div>
        </div>
      )}

      {isDialogOpen && selectedProvider === 'gitlab' && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-bolt-elements-bg-depth-1 rounded-xl shadow-xl border border-bolt-elements-borderColor w-full max-w-4xl max-h-[90vh] overflow-hidden">
            <div className="p-5 border-b border-bolt-elements-borderColor flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-bolt-elements-item-backgroundAccent flex items-center justify-center">
                  <div className="i-bolt:gitlab text-xl text-bolt-elements-item-contentAccent" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-bolt-elements-textPrimary">Import from GitLab</h3>
                  <p className="text-xs text-bolt-elements-textSecondary">Select a repository to clone</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setIsDialogOpen(false);
                  setSelectedProvider(null);
                }}
                className="p-2 rounded-lg hover:bg-bolt-elements-item-backgroundActive text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary transition-all duration-200"
              >
                <div className="i-ph:x text-lg" />
              </button>
            </div>

            <div className="p-5 max-h-[calc(90vh-100px)] overflow-y-auto">
              <GitLabRepositorySelector onClone={handleClone} />
            </div>
          </div>
        </div>
      )}

      {loading && <LoadingOverlay message="Cloning repository..." />}
    </>
  );
}
