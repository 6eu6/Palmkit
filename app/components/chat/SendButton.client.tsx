import { AnimatePresence, cubicBezier, motion } from 'framer-motion';

interface SendButtonProps {
  show: boolean;
  isStreaming?: boolean;
  disabled?: boolean;
  onClick?: (event: React.MouseEvent<HTMLButtonElement, MouseEvent>) => void;
  onImagesSelected?: (images: File[]) => void;
}

const customEasingFn = cubicBezier(0.4, 0, 0.2, 1);

export const SendButton = ({ show, isStreaming, disabled, onClick }: SendButtonProps) => {
  return (
    <AnimatePresence>
      {show ? (
        <motion.button
          className="absolute flex justify-center items-center top-3 right-3 p-1.5 rounded-xl w-[32px] h-[32px] transition-all duration-150 disabled:opacity-30 disabled:cursor-not-allowed"
          style={{
            background: isStreaming
              ? 'rgba(239, 68, 68, 0.9)'
              : 'var(--palmkit-elements-textPrimary)',
          }}
          transition={{ ease: customEasingFn, duration: 0.15 }}
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          disabled={disabled}
          onClick={(event) => {
            event.preventDefault();

            if (!disabled) {
              onClick?.(event);
            }
          }}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <div className="text-sm text-palmkit-elements-bg-depth-1">
            {!isStreaming ? <div className="i-ph:arrow-up-bold"></div> : <div className="i-ph:stop-bold"></div>}
          </div>
        </motion.button>
      ) : null}
    </AnimatePresence>
  );
};
