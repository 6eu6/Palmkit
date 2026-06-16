import type { Message } from 'ai';
import { toast } from 'react-toastify';
import { ImportFolderButton } from '~/components/chat/ImportFolderButton';
import { Button } from '~/components/ui/Button';
import { classNames } from '~/utils/classNames';

type ChatData = {
  messages?: Message[];
  description?: string;
};

export function ImportButtons(importChat: ((description: string, messages: Message[]) => Promise<void>) | undefined) {
  return (
    <>
      <input
        type="file"
        id="chat-import"
        className="hidden"
        accept=".json"
        onChange={async (e) => {
          const file = e.target.files?.[0];

          if (file && importChat) {
            try {
              const reader = new FileReader();

              reader.onload = async (e) => {
                try {
                  const content = e.target?.result as string;
                  const data = JSON.parse(content) as ChatData;

                  if (Array.isArray(data.messages)) {
                    await importChat(data.description || 'Imported Chat', data.messages);
                    toast.success('Chat imported successfully');

                    return;
                  }

                  toast.error('Invalid chat file format');
                } catch (error: unknown) {
                  if (error instanceof Error) {
                    toast.error('Failed to parse chat file: ' + error.message);
                  } else {
                    toast.error('Failed to parse chat file');
                  }
                }
              };
              reader.onerror = () => toast.error('Failed to read chat file');
              reader.readAsText(file);
            } catch (error) {
              toast.error(error instanceof Error ? error.message : 'Failed to import chat');
            }
            e.target.value = '';
          } else {
            toast.error('Something went wrong');
          }
        }}
      />
      <Button
        onClick={() => {
          const input = document.getElementById('chat-import');
          input?.click();
        }}
        variant="default"
        size="sm"
        className={classNames(
          'gap-2',
          'bg-[rgba(139,92,246,0.06)] border border-[rgba(139,92,246,0.12)]',
          'text-purple-200/80 hover:text-purple-100',
          'hover:bg-[rgba(139,92,246,0.12)] hover:border-[rgba(139,92,246,0.2)]',
          'h-9 px-3 py-1.5 sm:h-10 sm:px-4 sm:py-2 sm:min-w-[120px] justify-center',
          'transition-all duration-200 ease-out',
          'hover:shadow-[0_0_16px_var(--palmkit-glow-color)]',
          'text-xs sm:text-sm',
          'rounded-lg',
        )}
      >
        <span className="i-ph:file-import text-base sm:text-lg" />
        <span className="hidden sm:inline">Import Chat</span>
        <span className="sm:hidden">Chat</span>
      </Button>
      <ImportFolderButton
        importChat={importChat}
        className={classNames(
          'gap-2',
          'bg-[rgba(139,92,246,0.06)] border border-[rgba(139,92,246,0.12)]',
          'text-purple-200/80 hover:text-purple-100',
          'hover:bg-[rgba(139,92,246,0.12)] hover:border-[rgba(139,92,246,0.2)]',
          'h-9 px-3 py-1.5 sm:h-10 sm:px-4 sm:py-2 sm:min-w-[120px] justify-center',
          'transition-all duration-200 ease-out',
          'hover:shadow-[0_0_16px_var(--palmkit-glow-color)]',
          'text-xs sm:text-sm',
          'rounded-lg',
        )}
      />
    </>
  );
}
