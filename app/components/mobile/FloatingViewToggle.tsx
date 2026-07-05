import { useStore } from '@nanostores/react';
import { motion, useMotionValue, animate } from 'framer-motion';
import { memo, useEffect, useRef, useState } from 'react';
import { chatStore } from '~/lib/stores/chat';
import { workbenchStore } from '~/lib/stores/workbench';
import { mobileActiveTab } from '~/lib/stores/mobile';
import { previewFilesStore } from '~/lib/stores/build-status';
import { classNames } from '~/utils/classNames';

/**
 * FloatingViewToggle — a draggable, glassy pill that swaps the mobile view
 * between Chat and App (preview), replacing the fixed bottom Chat/App dock.
 *
 * Why: the bottom dock permanently ate a strip of vertical space. A single
 * floating control that the user can fling to any edge frees that space and
 * gives the chat/preview the full screen — the phone gets noticeably bigger.
 *
 * Behaviour:
 *  • In Chat with a preview available → shows the App/preview icon; tap slides
 *    the App in. In App → shows the Chat icon; tap slides Chat back.
 *  • Drag it anywhere; on release it snaps to the nearest side and its resting
 *    spot is remembered (localStorage). A drag never counts as a tap.
 *  • Mobile only, and only once there's something to preview.
 */
const SIZE = 52;
const MARGIN = 10;
const KEY = 'palmkit_view_toggle_pos';

function loadPos(w: number, h: number) {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');

    if (raw && typeof raw.side === 'string' && typeof raw.y === 'number') {
      const x = raw.side === 'left' ? MARGIN : w - SIZE - MARGIN;
      const y = Math.min(Math.max(raw.y, 80), h - SIZE - 90);

      return { x, y };
    }
  } catch {
    /* ignore */
  }

  // default: right edge, a little above the composer
  return { x: w - SIZE - MARGIN, y: Math.round(h * 0.62) };
}

export const FloatingViewToggle = memo(() => {
  const showWorkbench = useStore(workbenchStore.showWorkbench);
  const chat = useStore(chatStore);
  const previewFiles = useStore(previewFilesStore);

  const hasPreview = Object.keys(previewFiles).length > 0;
  const [mounted, setMounted] = useState(false);
  const draggingRef = useRef(false);
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  useEffect(() => {
    setMounted(true);

    const { x: px, y: py } = loadPos(window.innerWidth, window.innerHeight);
    x.set(px);
    y.set(py);
  }, []);

  // Keep it on-screen when the viewport changes (rotation / keyboard).
  useEffect(() => {
    const onResize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const side = x.get() + SIZE / 2 < w / 2 ? 'left' : 'right';
      animate(x, side === 'left' ? MARGIN : w - SIZE - MARGIN, { duration: 0.2 });
      animate(y, Math.min(Math.max(y.get(), 80), h - SIZE - 90), { duration: 0.2 });
    };
    window.addEventListener('resize', onResize);

    return () => window.removeEventListener('resize', onResize);
  }, []);

  if (!mounted || !chat.started) {
    return null;
  }

  // Only meaningful when there's an app to look at (or we're already in it).
  if (!hasPreview && !showWorkbench) {
    return null;
  }

  const toView = showWorkbench ? 'chat' : 'app';

  const toggle = () => {
    if (draggingRef.current) {
      return;
    }

    if (toView === 'app') {
      chatStore.setKey('showChat', false);
      workbenchStore.showWorkbench.set(true);
      mobileActiveTab.set('workspace');
    } else {
      chatStore.setKey('showChat', true);
      workbenchStore.showWorkbench.set(false);
      mobileActiveTab.set('chat');
    }
  };

  return (
    <motion.button
      type="button"
      aria-label={toView === 'app' ? 'Open app preview' : 'Back to chat'}
      className={classNames(
        'sm:hidden fixed left-0 top-0 z-[60] flex items-center justify-center rounded-full',
        'border border-[var(--pk-glass-border-hi)] bg-[var(--pk-glass-bg-hi)] backdrop-blur-2xl backdrop-saturate-[1.8]',
        'text-palmkit-elements-textPrimary active:scale-95',
        'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.5),0_8px_22px_-6px_rgba(0,0,0,0.35)]',
      )}
      style={{ x, y, width: SIZE, height: SIZE, touchAction: 'none' }}
      drag
      dragMomentum={false}
      dragElastic={0.06}
      dragConstraints={{
        left: MARGIN,
        right: (typeof window !== 'undefined' ? window.innerWidth : 400) - SIZE - MARGIN,
        top: 72,
        bottom: (typeof window !== 'undefined' ? window.innerHeight : 800) - SIZE - 84,
      }}
      onDragStart={() => {
        draggingRef.current = true;
      }}
      onDragEnd={() => {
        const w = window.innerWidth;
        const side = x.get() + SIZE / 2 < w / 2 ? 'left' : 'right';
        animate(x, side === 'left' ? MARGIN : w - SIZE - MARGIN, { type: 'spring', stiffness: 400, damping: 32 });

        try {
          localStorage.setItem(KEY, JSON.stringify({ side, y: y.get() }));
        } catch {
          /* ignore */
        }

        // let the click-suppression outlive the drag's synthetic click
        setTimeout(() => {
          draggingRef.current = false;
        }, 60);
      }}
      onClick={toggle}
    >
      <span className={classNames(toView === 'app' ? 'i-ph:play-circle-fill' : 'i-ph:chat-circle-fill', 'text-2xl')} />
      {/* "something to look at" pulse when a fresh preview is waiting in Chat */}
      {toView === 'app' && (
        <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-[var(--pk-accent)]">
          <span className="absolute inset-0 animate-ping rounded-full bg-[var(--pk-accent)] opacity-60" />
        </span>
      )}
    </motion.button>
  );
});

FloatingViewToggle.displayName = 'FloatingViewToggle';
