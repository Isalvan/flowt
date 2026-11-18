import { useEffect, useRef } from "react";

/** Movement (px) before deciding whether a gesture is horizontal or vertical. */
const AXIS_LOCK = 10;
/** Share of the width a slow drag has to cover to change tab. */
const COMMIT_SHARE = 0.3;
/** A flick this fast (px/ms) changes tab even if it was short. */
const FLICK_SPEED = 0.45;
const FLICK_MIN = 40;
const OUT_MS = 160;
const IN_MS = 260;
const EASE_OUT = "cubic-bezier(0.22, 1, 0.36, 1)";

const mediaMatches = (query: string) => window.matchMedia?.(query)?.matches ?? false;

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

interface SwipeTabsOptions {
  /** Whether there is a tab in that direction (1 = next, -1 = previous). */
  canGo: (direction: 1 | -1) => boolean;
  /** Switch to the tab in that direction. Called while the page is off screen. */
  onSwipe: (direction: 1 | -1) => void;
}

/**
 * Lets the user drag `root` sideways on a phone to move between tabs: the
 * page follows the finger, and on release it either slides out and the next
 * tab slides in, or springs back. Takes the element itself (not a ref) so it
 * attaches once the element mounts. Native listeners, so touches inside
 * portalled modals never reach it.
 */
export function useSwipeTabs(root: HTMLElement | null, options: SwipeTabsOptions, enabled = true) {
  const opts = useRef(options);
  useEffect(() => {
    opts.current = options;
  });

  useEffect(() => {
    if (!root || !enabled) return;
    const reduceMotion = mediaMatches("(prefers-reduced-motion: reduce)");
    let start: { x: number; y: number; t: number } | null = null;
    let axis: "x" | "y" | null = null;
    let dx = 0;
    let animating = false;
    const timers: number[] = [];

    const setStyle = (transform: string, opacity: string, transition: string) => {
      root.style.transition = transition;
      root.style.transform = transform;
      root.style.opacity = opacity;
    };
    // A transform on the page would make it the containing block of anything
    // fixed inside it, so it only stays on while a gesture or animation runs.
    const clearStyle = () => {
      root.style.transition = "";
      root.style.transform = "";
      root.style.opacity = "";
      root.style.willChange = "";
    };
    const later = (fn: () => void, ms: number) => timers.push(window.setTimeout(fn, ms));

    const onStart = (e: TouchEvent) => {
      start = null;
      axis = null;
      dx = 0;
      if (animating || e.touches.length !== 1) return;
      if (mediaMatches("(min-width: 768px)")) return;
      if (ownsHorizontalGesture(e.target, root)) return;
      const t = e.touches[0];
      start = { x: t.clientX, y: t.clientY, t: Date.now() };
    };

    const onMove = (e: TouchEvent) => {
      if (!start) return;
      const t = e.touches[0];
      const rawX = t.clientX - start.x;
      const rawY = t.clientY - start.y;
      if (!axis) {
        if (Math.abs(rawX) < AXIS_LOCK && Math.abs(rawY) < AXIS_LOCK) return;
        axis = Math.abs(rawX) > Math.abs(rawY) * 1.2 ? "x" : "y";
        if (axis === "y") {
          start = null;
          return;
        }
        root.style.willChange = "transform";
      }
      // Horizontal drag: the page follows the finger instead of scrolling.
      if (e.cancelable) e.preventDefault();
      const direction = rawX < 0 ? 1 : -1;
      // Past the first or last tab it only gives a little, like a rubber band.
      dx = opts.current.canGo(direction) ? rawX : rawX * 0.25;
      const width = root.clientWidth || window.innerWidth;
      setStyle(`translate3d(${dx}px,0,0)`, String(1 - Math.min(0.35, (Math.abs(dx) / width) * 0.5)), "none");
    };

    const onEnd = () => {
      if (!start || axis !== "x") {
        start = null;
        return;
      }
      const elapsed = Math.max(1, Date.now() - start.t);
      start = null;
      const width = root.clientWidth || window.innerWidth;
      const direction: 1 | -1 = dx < 0 ? 1 : -1;
      const fast = Math.abs(dx) / elapsed > FLICK_SPEED && Math.abs(dx) > FLICK_MIN;
      const commit = opts.current.canGo(direction) && (Math.abs(dx) > width * COMMIT_SHARE || fast);

      if (!commit) {
        animating = true;
        setStyle("translate3d(0,0,0)", "1", `transform ${IN_MS}ms ${EASE_OUT}, opacity ${IN_MS}ms ${EASE_OUT}`);
        later(() => {
          clearStyle();
          animating = false;
        }, IN_MS);
        return;
      }
      if (reduceMotion) {
        clearStyle();
        opts.current.onSwipe(direction);
        return;
      }
      animating = true;
      // Out: the current tab keeps going the way the finger went.
      setStyle(`translate3d(${-direction * width}px,0,0)`, "0", `transform ${OUT_MS}ms ease-in, opacity ${OUT_MS}ms ease-in`);
      later(() => {
        opts.current.onSwipe(direction);
        // In: the new tab arrives from the other side.
        setStyle(`translate3d(${direction * width * 0.35}px,0,0)`, "0", "none");
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            setStyle("translate3d(0,0,0)", "1", `transform ${IN_MS}ms ${EASE_OUT}, opacity ${IN_MS}ms ${EASE_OUT}`);
            later(() => {
              clearStyle();
              animating = false;
            }, IN_MS);
          }),
        );
      }, OUT_MS);
    };

    root.addEventListener("touchstart", onStart, { passive: true });
    root.addEventListener("touchmove", onMove, { passive: false });
    root.addEventListener("touchend", onEnd, { passive: true });
    root.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      root.removeEventListener("touchstart", onStart);
      root.removeEventListener("touchmove", onMove);
      root.removeEventListener("touchend", onEnd);
      root.removeEventListener("touchcancel", onEnd);
      timers.forEach((id) => window.clearTimeout(id));
      clearStyle();
    };
  }, [root, enabled]);
}
