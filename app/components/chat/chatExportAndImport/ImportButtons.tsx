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
          'gap-2 bg-bolt-elements-bg-depth-1/80',
          'text-bolt-elements-textPrimary',
          'hover:bg-bolt-elements-button-primary-background hover:text-bolt-elements-button-primary-text',
          'border border-bolt-elements-borderColor',
          'h-9 px-3 py-1.5 sm:h-10 sm:px-4 sm:py-2 sm:min-w-[120px] justify-center',
          'transition-all duration-200 ease-out',
          'backdrop-blur-sm',
          'hover:shadow-[0_0_16px_var(--bolt-glow-color)]',
          'text-xs sm:text-sm',
        )}
      >
        <span className="i-ph:upload-simple text-base sm:text-lg" />
        <span className="hidden sm:inline">Import Chat</span>
        <span className="sm:hidden">Chat</span>
      </Button>
      <ImportFolderButton
        importChat={importChat}
        className={classNames(
          'gap-2 bg-bolt-elements-bg-depth-1/80',
          'text-bolt-elements-textPrimary',
          'hover:bg-bolt-elements-button-primary-background hover:text-bolt-elements-button-primary-text',
          'border border-bolt-elements-borderColor',
          'h-9 px-3 py-1.5 sm:h-10 sm:px-4 sm:py-2 sm:min-w-[120px] justify-center',
          'transition-all duration-200 ease-out',
          'backdrop-blur-sm',
          'hover:shadow-[0_0_16px_var(--bolt-glow-color)]',
          'text-xs sm:text-sm',
        )}
      />
    </>
  );
}
