import { animate, motionValue } from 'framer-motion';

/**
 * One motion value shared by the drawer and the app surface it pushes.
 *
 * 0 = closed, 1 = fully open. Both the drawer's own position and the shell's
 * translate/scale/radius are derived from it, which is what makes the two move
 * as a single physical thing under the finger. Two independent animations —
 * one for the panel, one for a CSS class on the shell — can never stay in
 * step during a drag, which is why this is a MotionValue rather than a boolean
 * plus a transition.
 */
export const drawerProgress = motionValue(0);

const SPRING = { type: 'spring' as const, damping: 38, stiffness: 420, mass: 0.9 };

/** How far the surface travels — also the drawer's width. */
export function drawerWidth(): number {
  if (typeof window === 'undefined') {
    return 300;
  }

  /*
   * 73% of the screen, measured off the reference recording: the conversation
   * slides that far and the remaining strip is what you tap to come back.
   */
  return Math.round(window.innerWidth * 0.73);
}

export function animateDrawer(to: 0 | 1) {
  animate(drawerProgress, to, SPRING);
}

/** Set directly while a finger is down — no animation, it must track the touch. */
export function setDrawerProgress(value: number) {
  drawerProgress.set(Math.max(0, Math.min(1, value)));
}
