import { useEffect, useState } from 'react';

/**
 * Height currently covered by the on-screen keyboard, in CSS pixels.
 *
 * A phone keyboard does NOT shrink the layout viewport, so `position: fixed;
 * bottom: 0` stays pinned behind it — which is why a bottom action button
 * appears stranded in the middle of the screen once the keyboard opens. The
 * visual viewport does shrink, and the difference between the two is exactly
 * how far the element has to be lifted.
 *
 * Returns 0 on desktop and wherever `visualViewport` is unavailable.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;

    if (!vv) {
      return undefined;
    }

    const update = () => {
      /*
       * `offsetTop` matters when the page is scrolled under a keyboard: the
       * visible area starts lower, so the covered strip is what remains below
       * it, not simply the height difference.
       */
      const covered = window.innerHeight - vv.height - vv.offsetTop;

      // Ignore browser-chrome jitter; only a real keyboard clears this.
      setInset(covered > 80 ? Math.round(covered) : 0);
    };

    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);

    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  return inset;
}
