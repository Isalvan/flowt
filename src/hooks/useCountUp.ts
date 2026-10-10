import { useEffect, useRef, useState } from 'react';

/** Eases a number towards `end`; the returned value is what to paint this frame. */
export const useCountUp = (end: number, duration = 1.5, preserveValue = false) => {
  const [value, setValue] = useState(0);
  const shown = useRef(0);

  useEffect(() => {
    const from = preserveValue ? shown.current : 0;
    let startTimestamp: number | null = null;
    let animationFrameId: number;

    const paint = (next: number) => {
      shown.current = next;
      setValue(next);
    };

    const step = (timestamp: number) => {
      if (!startTimestamp) startTimestamp = timestamp;
      const progress = Math.min((timestamp - startTimestamp) / (duration * 1000), 1);

      // easeOutExpo para un efecto realista de frenado
      const easeOut = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);

      if (progress < 1) {
        paint(from + (end - from) * easeOut);
        animationFrameId = window.requestAnimationFrame(step);
      } else {
        paint(end);
      }
    };

    animationFrameId = window.requestAnimationFrame(step);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
    };
  }, [end, duration, preserveValue]);

  return value;
};
