/**
 * FormatConversionActions
 * =======================
 * Quick-action buttons shown below assistant messages in Work mode.
 *
 * Lets the user request format conversion with ONE click:
 *   - "Save as PDF" → sends "Please convert the above content to a downloadable PDF"
 *   - "Save as Word" → sends "Please convert the above content to a downloadable Word document"
 *   - "Save as Excel" → sends "Please convert the above data to a downloadable spreadsheet"
 *
 * Why this is NOT hardcoded behavior:
 *   - The buttons just SEND A MESSAGE — the model decides whether to call
 *     create_pdf/create_docx/create_xlsx based on the content + the request.
 *   - If the content isn't suitable (e.g. no tabular data for XLSX), the
 *     model can refuse or ask for clarification.
 *   - The user can also type their own message — the buttons are just
 *     a convenience shortcut.
 *
 * Visibility rules:
 *   - Only shown in Work mode (sidebarMode === 'work')
 *   - Only shown after the assistant responds (not while streaming)
 *   - Only shown if the message has substantial content (>200 chars)
 *     (short responses don't need conversion)
 *   - User can dismiss the buttons (they remember dismissal per message)
 *
 * The buttons appear as small chips below the markdown content,
 * visually distinct from the quick-actions the model generates
 * (those are <palmkit-quick-action> tags parsed by the Markdown component).
 */

import { memo, useState, useEffect } from 'react';
import { classNames } from '~/utils/classNames';

interface FormatConversionActionsProps {
  /** The assistant message content (used to check length + send back). */
  content: string;

  /** Message ID for dismissal tracking. */
  messageId?: string;

  /** Current sidebar mode — buttons only show in 'work'. */
  sidebarMode?: 'chat' | 'work' | 'code';

  /** Callback to send a follow-up message. */
  onSendMessage: (message: string) => void;

  /** Whether the assistant is currently streaming (hide buttons while streaming). */
  isStreaming?: boolean;
}

type Format = 'pdf' | 'docx' | 'xlsx';

interface FormatOption {
  format: Format;
  label: string;
  iconClass: string;
  message: string;

  /** Function to check if the content is suitable for this format. */
  isSuitable: (content: string) => boolean;
}

const FORMAT_OPTIONS: FormatOption[] = [
  {
    format: 'pdf',
    label: 'Save as PDF',
    iconClass: 'i-ph:file-pdf',
    message:
      'Please convert the above content into a downloadable PDF document. Use the create_pdf tool with the content I provided.',
    isSuitable: (content) => content.length > 200,
  },
  {
    format: 'docx',
    label: 'Save as Word',
    iconClass: 'i-ph:file-doc',
    message:
      'Please convert the above content into a downloadable Word document (.docx). Use the create_docx tool with the content I provided.',
    isSuitable: (content) => content.length > 200,
  },
  {
    format: 'xlsx',
    label: 'Save as Excel',
    iconClass: 'i-ph:file-xls',
    message:
      'Please convert the above tabular data into a downloadable spreadsheet (.xlsx). Use the create_xlsx tool. If the data above is not tabular, ask me to format it as a table first.',
    isSuitable: (content) => {
      // Only show XLSX option if content has markdown table syntax OR CSV-like structure
      const hasMarkdownTable = /\|.*\|[\s\S]*?\n\|[\s-:]+\|/.test(content);
      const hasCsvStructure = content.split('\n').filter((l) => l.split(',').length >= 3).length >= 2;
      const hasJsonArray = /\[\s*\{[\s\S]*\}\s*\]/.test(content);

      return hasMarkdownTable || hasCsvStructure || hasJsonArray;
    },
  },
];

function FormatConversionActionsImpl({
  content,
  messageId,
  sidebarMode,
  onSendMessage,
  isStreaming,
}: FormatConversionActionsProps) {
  const [dismissed, setDismissed] = useState(false);

  // Reset dismissal when message changes
  useEffect(() => {
    setDismissed(false);
  }, [messageId]);

  // Don't render in chat or code mode
  if (sidebarMode !== 'work') {
    return null;
  }

  // Don't render while streaming
  if (isStreaming) {
    return null;
  }

  // Don't render if dismissed
  if (dismissed) {
    return null;
  }

  // Don't render for very short messages
  if (content.length < 200) {
    return null;
  }

  // Filter to only suitable formats
  const availableFormats = FORMAT_OPTIONS.filter((f) => f.isSuitable(content));

  if (availableFormats.length === 0) {
    return null;
  }

  const handleClick = (format: FormatOption) => {
    onSendMessage(format.message);
  };

  const handleDismiss = () => {
    setDismissed(true);
  };

  return (
    <div className="mt-3 pt-3 border-t border-palmkit-elements-borderColor flex items-center gap-2 flex-wrap">
      <span className="text-[10px] uppercase text-palmkit-elements-textSecondary tracking-wide">Convert to:</span>
      {availableFormats.map((format) => (
        <button
          key={format.format}
          onClick={() => handleClick(format)}
          className={classNames(
            'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
            'bg-palmkit-elements-background-depth-2 hover:bg-palmkit-elements-item-contentAccent/10',
            'text-palmkit-elements-textSecondary hover:text-palmkit-elements-item-contentAccent',
            'border border-palmkit-elements-borderColor hover:border-palmkit-elements-item-contentAccent/30',
          )}
          title={`Convert the above content to ${format.format.toUpperCase()}`}
        >
          <div className={classNames('text-sm', format.iconClass)} />
          {format.label}
        </button>
      ))}
      <button
        onClick={handleDismiss}
        className="ml-auto text-[10px] text-palmkit-elements-textSecondary hover:text-palmkit-elements-textPrimary transition-colors"
        title="Hide conversion options"
      >
        <div className="i-ph:x text-xs" />
      </button>
    </div>
  );
}

export const FormatConversionActions = memo(FormatConversionActionsImpl);
