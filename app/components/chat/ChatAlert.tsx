import { AnimatePresence, motion } from 'framer-motion';
import type { ActionAlert } from '~/types/actions';
import { classNames } from '~/utils/classNames';

interface Props {
  alert: ActionAlert;
  clearAlert: () => void;
  postMessage: (message: string) => void;
}

export default function ChatAlert({ alert, clearAlert, postMessage }: Props) {
  const { description, content, source } = alert;

  const isPreview = source === 'preview';
  const title = isPreview ? 'Preview Error' : 'Terminal Error';
  const message = isPreview
    ? 'We encountered an error while running the preview. Would you like Palmkit to analyze and help resolve this issue?'
    : 'We encountered an error while running terminal commands. Would you like Palmkit to analyze and help resolve this issue?';

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        transition={{ duration: 0.3 }}
        className={`rounded-lg border border-palmkit-elements-borderColor bg-palmkit-elements-background-depth-2 p-4 mb-2`}
      >
        <div className="flex items-start">
          {/* Icon */}
          <motion.div
            className="flex-shrink-0"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2 }}
          >
            <div className={`i-ph:warning-duotone text-xl text-palmkit-elements-button-danger-text`}></div>
          </motion.div>
          {/* Content */}
          <div className="ml-3 flex-1">
            <motion.h3
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.1 }}
              className={`text-sm font-medium text-palmkit-elements-textPrimary`}
            >
              {title}
            </motion.h3>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
              className={`mt-2 text-sm text-palmkit-elements-textSecondary`}
            >
              <p>{message}</p>
              {description && (
                <div className="text-xs text-palmkit-elements-textSecondary p-2 bg-palmkit-elements-background-depth-3 rounded mt-4 mb-4">
                  Error: {description}
                </div>
              )}
            </motion.div>

            {/* Actions */}
            <motion.div
              className="mt-4"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
            >
              <div className={classNames(' flex gap-2')}>
                <button
                  onClick={() =>
                    postMessage(
                      `*Fix this ${isPreview ? 'preview' : 'terminal'} error* \n\`\`\`${isPreview ? 'js' : 'sh'}\n${content}\n\`\`\`\n`,
                    )
                  }
                  className={classNames(
                    `px-2 py-1.5 rounded-md text-sm font-medium`,
                    'bg-palmkit-elements-button-primary-background',
                    'hover:bg-palmkit-elements-button-primary-backgroundHover',
                    'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-palmkit-elements-button-danger-background',
                    'text-palmkit-elements-button-primary-text',
                    'flex items-center gap-1.5',
                  )}
                >
                  <div className="i-ph:chat-circle-duotone"></div>
                  Ask Palmkit
                </button>
                <button
                  onClick={clearAlert}
                  className={classNames(
                    `px-2 py-1.5 rounded-md text-sm font-medium`,
                    'bg-palmkit-elements-button-secondary-background',
                    'hover:bg-palmkit-elements-button-secondary-backgroundHover',
                    'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-palmkit-elements-button-secondary-background',
                    'text-palmkit-elements-button-secondary-text',
                  )}
                >
                  Dismiss
                </button>
              </div>
            </motion.div>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
