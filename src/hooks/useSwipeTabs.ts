import { useEffect, useRef } from "react";

/** Horizontal distance (px) a finger has to travel to count as a swipe. */
const MIN_DISTANCE = 70;
/** Slower drags are reading or scrolling, not a swipe. */
const MAX_DURATION = 600;

/**
 * True when the touch started inside something that handles horizontal
 * gestures itself: a carousel or other horizontal scroller, a slider, a
 * text field, a dialog, or anything that opts out with `data-no-swipe`.
 */
export function ownsHorizontalGesture(target: EventTarget | null, root: Element): boolean {
  let el = target instanceof Element ? target : null;
  while (el && el !== root) {
    if (el.closest("input, textarea, select, [contenteditable='true'], [role='dialog'], [data-no-swipe]")) return true;
    const overflowX = window.getComputedStyle(el).overflowX;
    if ((overflowX === "auto" || overflowX === "scroll") && el.scrollWidth > el.clientWidth) return true;
    el = el.parentElement;
  }
  return false;
}

/**
 * Calls `onSwipe(1)` for a swipe to the left (next tab) and `onSwipe(-1)` for
 * a swipe to the right (previous tab) made on `root`. Takes the element
 * itself (not a ref) so it attaches once the element mounts. Native
 * listeners, so touches inside portalled modals never reach it.
 */
export function useSwipeTabs(
  root: HTMLElement | null,
  onSwipe: (direction: 1 | -1) => void,
  enabled = true,
) {
  const callback = useRef(onSwipe);
  useEffect(() => {
    callback.current = onSwipe;
  });

  useEffect(() => {
    if (!root || !enabled) return;
    let start: { x: number; y: number; t: number } | null = null;

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || ownsHorizontalGesture(e.target, root)) {
        start = null;
        return;
      }
      const t = e.touches[0];
      start = { x: t.clientX, y: t.clientY, t: Date.now() };
    };
    const onEnd = (e: TouchEvent) => {
      if (!start) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      const quick = Date.now() - start.t <= MAX_DURATION;
      start = null;
      if (quick && Math.abs(dx) >= MIN_DISTANCE && Math.abs(dx) > Math.abs(dy) * 1.5) {
        callback.current(dx < 0 ? 1 : -1);
      }
    };
    const onCancel = () => {
      start = null;
    };

    root.addEventListener("touchstart", onStart, { passive: true });
    root.addEventListener("touchend", onEnd, { passive: true });
    root.addEventListener("touchcancel", onCancel, { passive: true });
    return () => {
      root.removeEventListener("touchstart", onStart);
      root.removeEventListener("touchend", onEnd);
      root.removeEventListener("touchcancel", onCancel);
    };
  }, [root, enabled]);
}
