import { useEffect } from 'react';

/** Movement that counts as "the user started scrolling", not a shaky finger. */
const MOVE_THRESHOLD = 12;

/**
 * Ignore the tail of the gesture that opened the thing.
 *
 * A long-press opens its menu while the finger is still down, so the very next
 * touchmove is part of that same press — closing on it would make the menu
 * impossible to open by long-press at all.
 */
const ARM_DELAY_MS = 220;

/**
 * Close a floating surface as soon as the page moves under it.
 *
 * Menus and popovers are positioned once, against the element that opened
 * them. Scroll the list behind one and it stays pinned where it was, floating
 * over unrelated rows — it has to go away instead. Anchored surfaces have no
 * business surviving a scroll on a phone.
 *
 * Listens for real scrolling AND for a finger dragging anywhere, because a
 * short list generates no scroll event at all: the swipe would move nothing,
 * the menu would sit there, and the gesture would feel ignored.
 */
export function useDismissOnScroll(open: boolean, onDismiss: () => void, ignoreSelector?: string) {
  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const armedAt = Date.now() + ARM_DELAY_MS;
    let start: { x: number; y: number } | null = null;

    /*
     * A surface that scrolls its own content must not dismiss itself when the
     * user scrolls it. Only movement OUTSIDE it counts.
     */
    const isInside = (target: EventTarget | null) =>
      Boolean(ignoreSelector && target instanceof Element && target.closest(ignoreSelector));

    const dismiss = (e?: Event) => {
      if (e && isInside(e.target)) {
        return;
      }

      if (Date.now() >= armedAt) {
        onDismiss();
      }
    };

    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      start = t ? { x: t.clientX, y: t.clientY } : null;
    };

    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];

      if (!t || isInside(e.target)) {
        return;
      }

      if (!start) {
        start = { x: t.clientX, y: t.clientY };
        return;
      }

      if (Math.hypot(t.clientX - start.x, t.clientY - start.y) > MOVE_THRESHOLD) {
        dismiss();
      }
    };

    // Capture, so a scroll inside any container reaches us and not just window.
    window.addEventListener('scroll', dismiss, { capture: true, passive: true });
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });

    return () => {
      window.removeEventListener('scroll', dismiss, { capture: true });
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
    };
  }, [open, onDismiss, ignoreSelector]);
}
