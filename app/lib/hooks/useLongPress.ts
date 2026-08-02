import { useCallback, useRef } from 'react';

/**
 * Long-press (touch) → callback, the standard phone gesture for "show me the
 * actions for this row".
 *
 * Cancels if the finger travels more than `moveTolerance` so a scroll is
 * never mistaken for a press, and suppresses the click that a touch device
 * synthesises on release — otherwise the long-press would also open the
 * conversation it was meant to show a menu for.
 */
export function useLongPress(onLongPress: () => void, { delay = 500, moveTolerance = 10 } = {}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const clear = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }

    start.current = null;
  }, []);

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length !== 1) {
        clear();
        return;
      }

      const t = e.touches[0];
      start.current = { x: t.clientX, y: t.clientY };
      fired.current = false;

      timer.current = setTimeout(() => {
        fired.current = true;
        onLongPress();
      }, delay);
    },
    [onLongPress, delay, clear],
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!start.current) {
        return;
      }

      const t = e.touches[0];

      if (
        Math.abs(t.clientX - start.current.x) > moveTolerance ||
        Math.abs(t.clientY - start.current.y) > moveTolerance
      ) {
        clear();
      }
    },
    [clear, moveTolerance],
  );

  const onTouchEnd = useCallback(() => clear(), [clear]);

  /**
   * Attach to the row's click handler: returns true when the click is the
   * tail of a long-press and should be ignored.
   */
  const consumedClick = useCallback(() => {
    if (fired.current) {
      fired.current = false;
      return true;
    }

    return false;
  }, []);

  return {
    handlers: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: onTouchEnd },
    consumedClick,
  };
}
