/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Composer growth for a MODAL composer: the textarea sizes itself to its
 * content up to a ceiling, and the enclosing card grows with it.
 *
 * The chat composer deliberately does NOT do this — its textarea is a fixed
 * box that scrolls, because the timeline owns the space and a composer that
 * grew on every paste would move the conversation under the reader's cursor.
 * Inside a modal there is nothing to push around: the card is the only thing on
 * screen, so growing it is free, and a multi-paragraph prompt is then visible
 * while it is written.
 *
 * The ceiling is the whole point of the module: unbounded growth turns a pasted
 * transcript into a card taller than the viewport, with the toolbar and the
 * send button pushed off screen. `maxHeightPx` keeps the composer a composer,
 * and the textarea scrolls past it.
 */

import { useEffect, useRef } from 'preact/hooks';

export interface UseAutoGrowOptions {
  /** Current text; a change re-measures. */
  value: string;
  /** Height the box is never smaller than (its `min-h-*` class, in px). */
  minHeightPx: number;
  /** Height the box never exceeds; content past it scrolls. */
  maxHeightPx: number;
}

export function useAutoGrow({ value, minHeightPx, maxHeightPx }: UseAutoGrowOptions) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Reset first: `scrollHeight` reports the height the box would need AT its
    // current size, so measuring without collapsing would never shrink the box
    // back down after a deletion.
    el.style.height = 'auto';
    const next = Math.min(Math.max(el.scrollHeight, minHeightPx), maxHeightPx);
    el.style.height = `${next}px`;
    // Scroll only once the content actually exceeds the ceiling.
    el.style.overflowY = el.scrollHeight > maxHeightPx ? 'auto' : 'hidden';
  }, [value, minHeightPx, maxHeightPx]);

  return ref;
}
