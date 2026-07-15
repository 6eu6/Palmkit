import { useStore } from '@nanostores/react';
import { AnimatePresence, animate, motion, useMotionValue } from 'framer-motion';
import { memo, useEffect, useRef, useState } from 'react';
import { chatStore } from '~/lib/stores/chat';
import { workbenchStore } from '~/lib/stores/workbench';
import { buildStatusStore } from '~/lib/stores/build-status';
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
 *  • The very first time it appears it expands into a labelled pill for a few
 *    seconds ("App" / "Chat") so its purpose is obvious, then collapses.
 *  • Respects iPhone safe areas (Dynamic Island, home indicator, rounded
 *    corners) — it can never rest under system UI.
 *  • Mobile only, and only once there's something to preview.
 */
const SIZE = 52;
const MARGIN = 10;
const KEY = 'palmkit_view_toggle_pos';
const HINT_KEY = 'palmkit_view_toggle_hint_v1';

/** Read a safe-area inset (px) exposed as a CSS custom property in variables.scss. */
function safeInset(side: 'top' | 'bottom' | 'left' | 'right'): number {
  if (typeof document === 'undefined') {
    return 0;
  }

  const raw = getComputedStyle(document.documentElement).getPropertyValue(`--pk-safe-${side}`);
  const n = Number.parseFloat(raw);

  return Number.isFinite(n) ? n : 0;
}

function bounds(w: number, h: number) {
  return {
    left: MARGIN + safeInset('left'),
    right: w - SIZE - MARGIN - safeInset('right'),
    top: 72 + safeInset('top'),
    bottom: h - SIZE - 84 - safeInset('bottom'),
  };
}

function loadPos(w: number, h: number) {
  const b = bounds(w, h);

  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');

    if (raw && typeof raw.side === 'string' && typeof raw.y === 'number') {
      const x = raw.side === 'left' ? b.left : b.right;
      const y = Math.min(Math.max(raw.y, b.top), b.bottom);

      return { x, y };
    }
  } catch {
    /* ignore */
  }

  // default: right edge, a little above the composer
  return { x: b.right, y: Math.round(h * 0.62) };
}

export const FloatingViewToggle = memo(() => {
  const showWorkbench = useStore(workbenchStore.showWorkbench);
  const buildStatus = useStore(buildStatusStore);
  const chat = useStore(chatStore);
  const previewFiles = useStore(previewFilesStore);

  const hasPreview = Object.keys(previewFiles).length > 0;
  const [mounted, setMounted] = useState(false);
  const [showHint, setShowHint] = useState(false);
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
      const b = bounds(window.innerWidth, window.innerHeight);
      const side = x.get() + SIZE / 2 < window.innerWidth / 2 ? 'left' : 'right';
      animate(x, side === 'left' ? b.left : b.right, { duration: 0.2 });
      animate(y, Math.min(Math.max(y.get(), b.top), b.bottom), { duration: 0.2 });
    };
    window.addEventListener('resize', onResize);

    return () => window.removeEventListener('resize', onResize);
  }, []);

  const visible = mounted && chat.started && (hasPreview || showWorkbench);

  /*
   * First-appearance hint: expand into a labelled pill for a few seconds so
   * the control explains itself, then collapse to the plain glass disc.
   */
  useEffect(() => {
    if (!visible) {
      return undefined;
    }

    try {
      if (localStorage.getItem(HINT_KEY)) {
        return undefined;
      }

      localStorage.setItem(HINT_KEY, '1');
    } catch {
      /* ignore */
    }

    setShowHint(true);

    const t = setTimeout(() => setShowHint(false), 3200);

    return () => clearTimeout(t);
  }, [visible]);

  if (!visible) {
    return null;
  }

  /*
   * Hide while the build is actively generating — the floating play button
   * appearing mid-build is confusing (there's no preview to switch to yet,
   * and it overlaps the BuildStream). Show it only once the build reaches
   * ready_for_preview (or fails) — then the user can switch to the preview.
   */
  const isBuilding = buildStatus.jobStatus === 'generating' || buildStatus.jobStatus === 'incomplete_retrying';

  if (isBuilding && !showWorkbench) {
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

  const winW = typeof window !== 'undefined' ? window.innerWidth : 400;
  const winH = typeof window !== 'undefined' ? window.innerHeight : 800;
  const b = bounds(winW, winH);

  return (
    <motion.button
      type="button"
      aria-label={toView === 'app' ? 'Open app preview' : 'Back to chat'}
      className={classNames(
        'sm:hidden fixed left-0 top-0 z-[60] flex items-center justify-center gap-1.5 rounded-full',
        'border border-[var(--pk-glass-border-hi)] bg-[var(--pk-glass-bg-hi)] backdrop-blur-2xl backdrop-saturate-[1.8]',
        'text-palmkit-elements-textPrimary select-none [-webkit-touch-callout:none] [-webkit-tap-highlight-color:transparent]',

        // iOS material: lit top rim + faint bottom shade + inner glow + soft lift.
        'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.5),inset_0_-1px_0_0_rgba(0,0,0,0.05),inset_0_0_14px_0_rgba(255,255,255,0.07),0_8px_22px_-6px_rgba(0,0,0,0.35)]',
      )}
      style={{ x, y, height: SIZE, minWidth: SIZE, touchAction: 'none' }}
      whileTap={{ scale: 0.9 }}
      drag
      dragMomentum={false}
      dragElastic={0.06}
      dragConstraints={{ left: b.left, right: b.right, top: b.top, bottom: b.bottom }}
      onDragStart={() => {
        draggingRef.current = true;
        setShowHint(false);
      }}
      onDragEnd={() => {
        const bb = bounds(window.innerWidth, window.innerHeight);
        const side = x.get() + SIZE / 2 < window.innerWidth / 2 ? 'left' : 'right';
        animate(x, side === 'left' ? bb.left : bb.right, { type: 'spring', stiffness: 400, damping: 32 });

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
      {/* icon crossfades + rotates slightly between the two states */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={toView}
          initial={{ opacity: 0, rotate: -30, scale: 0.6 }}
          animate={{ opacity: 1, rotate: 0, scale: 1 }}
          exit={{ opacity: 0, rotate: 30, scale: 0.6 }}
          transition={{ duration: 0.16, ease: 'easeOut' }}
          className={classNames(toView === 'app' ? 'i-ph:play-circle-fill' : 'i-ph:chat-circle-fill', 'text-2xl')}
        />
      </AnimatePresence>

      {/* first-run label — the pill briefly explains itself, then collapses */}
      <AnimatePresence>
        {showHint && (
          <motion.span
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 'auto', opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="overflow-hidden whitespace-nowrap pr-3 text-sm font-medium"
          >
            {toView === 'app' ? 'View app' : 'Back to chat'}
          </motion.span>
        )}
      </AnimatePresence>

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
