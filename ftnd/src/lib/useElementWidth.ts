"use client";

import { useEffect, useState, type RefObject } from "react";

/**
 * Tracks the live pixel width of an element so SVG charts can re-layout on
 * container resize / browser zoom without losing their aspect ratio.
 */
export function useElementWidth(
  ref: RefObject<HTMLElement | null>,
  fallback = 720,
): number {
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const update = () => {
      const next = element.getBoundingClientRect().width;
      if (Number.isFinite(next) && next > 0) setWidth(Math.round(next));
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}
