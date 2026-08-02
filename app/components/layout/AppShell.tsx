import { motion, useTransform } from 'framer-motion';
import { useEffect, useRef, type ReactNode } from 'react';
import { animateDrawer, drawerProgress, drawerWidth, setDrawerProgress } from '~/lib/stores/drawerMotion';
import { mobileActiveTab } from '~/lib/stores/mobile';

/** Below this the gesture is treated as a tap, not a drag. */
const DIRECTION_LOCK = 8;

/** Fling speed (px/ms) that decides the outcome regardless of distance. */
const FLING = 0.45;

/** How close to the left edge a swipe must start to open the drawer. */
const EDGE_ZONE = 28;

/**
 * The app surface the projects drawer pushes aside — header + conversation.
 *
 * It is deliberately a SIBLING of the drawer, never its parent: a transform
 * makes an element the containing block for `position: fixed` descendants, so
 * a drawer nested inside would be pushed along by the very transform it is
 * causing.
 *
 * Both the shell and the drawer read the same `drawerProgress` motion value,
 * so during a drag they move as one piece instead of two things animating
 * toward the same end state at slightly different rates.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const width = typeof window === 'undefined' ? 320 : drawerWidth();

  const x = useTransform(drawerProgress, [0, 1], [0, width]);
  const scale = useTransform(drawerProgress, [0, 1], [1, 0.92]);
  const radius = useTransform(drawerProgress, [0, 1], [0, 22]);

  /*
   * The seam between the two layers. It deepens as the drawer opens, which is
   * what makes the surface read as lifted ABOVE the drawer rather than as a
   * flat panel swap.
   */
  const shadow = useTransform(drawerProgress, [0, 1], ['0 0 0 0 rgba(0,0,0,0)', '-16px 0 40px -8px rgba(0,0,0,0.45)']);

  const overlay = useTransform(drawerProgress, [0, 1], [0, 0.12]);

  const gesture = useRef<{ startX: number; startY: number; from: number; active: boolean; locked: boolean } | null>(
    null,
  );
  const lastRef = useRef<{ x: number; t: number } | null>(null);

  useEffect(() => {
    const isPhone = () => window.innerWidth < 640;

    const onStart = (e: TouchEvent) => {
      if (!isPhone() || e.touches.length !== 1) {
        gesture.current = null;
        return;
      }

      const t = e.touches[0];
      const progress = drawerProgress.get();

      /*
       * Closed: only a pull from the very left edge opens it, so the gesture
       * never fights horizontal scrollers inside the conversation.
       * Open: anywhere on the visible strip pushes it back.
       */
      if (progress < 0.02 && t.clientX > EDGE_ZONE) {
        gesture.current = null;
        return;
      }

      const target = e.target as HTMLElement | null;

      if (target?.closest('.cm-editor, .xterm, iframe, [data-no-swipe], input, textarea, select')) {
        gesture.current = null;
        return;
      }

      gesture.current = { startX: t.clientX, startY: t.clientY, from: progress, active: true, locked: false };
      lastRef.current = { x: t.clientX, t: performance.now() };
    };

    const onMove = (e: TouchEvent) => {
      const g = gesture.current;

      if (!g?.active) {
        return;
      }

      const t = e.touches[0];
      const dx = t.clientX - g.startX;
      const dy = t.clientY - g.startY;

      if (!g.locked) {
        if (Math.abs(dx) < DIRECTION_LOCK && Math.abs(dy) < DIRECTION_LOCK) {
          return;
        }

        // A mostly-vertical start is a scroll — hand it back to the page.
        if (Math.abs(dy) > Math.abs(dx)) {
          gesture.current = null;
          return;
        }

        g.locked = true;
      }

      setDrawerProgress(g.from + dx / drawerWidth());
      lastRef.current = { x: t.clientX, t: performance.now() };
    };

    const onEnd = () => {
      const g = gesture.current;
      gesture.current = null;

      if (!g?.locked) {
        return;
      }

      const last = lastRef.current;
      const velocity = last ? (last.x - g.startX) / Math.max(1, performance.now() - (last.t - 16)) : 0;
      const progress = drawerProgress.get();

      const open = Math.abs(velocity) > FLING ? velocity > 0 : progress > 0.5;

      animateDrawer(open ? 1 : 0);

      /*
       * Keep the store that owns "which mobile surface is showing" in step, so
       * the drawer's own close button and this gesture cannot disagree.
       */
      mobileActiveTab.set(open ? 'projects' : 'chat');
    };

    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd, { passive: true });
    window.addEventListener('touchcancel', onEnd, { passive: true });

    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  return (
    <motion.div
      className="pk-app-shell relative flex h-full w-full flex-col"
      style={{ x, scale, borderRadius: radius, boxShadow: shadow, transformOrigin: 'center left' }}
    >
      {children}

      {/* Tapping the pushed-aside surface closes the drawer. Only present
          while it is actually pushed, so it never swallows a normal tap. */}
      <motion.div
        className="absolute inset-0 z-20 bg-black"
        style={{ opacity: overlay, pointerEvents: useTransform(drawerProgress, (v) => (v > 0.02 ? 'auto' : 'none')) }}
        onClick={() => {
          animateDrawer(0);
          mobileActiveTab.set('chat');
        }}
      />
    </motion.div>
  );
}
