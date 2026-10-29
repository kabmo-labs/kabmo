/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Composer growth: the textarea sizes itself to its content up to a ceiling and
 * scrolls past it, and the enclosing card grows with it.
 *
 * The ceiling is the whole point of the module: unbounded growth turns a pasted
 * transcript into a box taller than the viewport, with the toolbar and the send
 * button pushed off screen. A caller states it either in px (the New Chat
 * modal, whose card has its own fixed size) or in LINES (the chat's docked
 * composer, whose type size is not one number: 13px on every platform except
 * iOS, which forces 16px to stop Safari zooming the page — a px cap would be a
 * different number of lines on each).
 *
 * Growth is measured only while the caller's layout does not own the height.
 * A stretched composer is sized by `composerExpansion` (a share of the viewport
 * on a desktop, `h-full` on a phone), so its caller passes `enabled: false` and
 * the hook clears its inline height instead of fighting that layout.
 */

import { useEffect, useRef } from 'preact/hooks';

/**
 * The docked chat composer's ceiling, in text lines. Seven is what fits above
 * the toolbar without the box becoming the transcript; past it the textarea
 * scrolls itself.
 */
export const CHAT_COMPOSER_MAX_LINES = 7;

export interface UseAutoGrowOptions {
  /** Current text; a change re-measures. */
  value: string;
  /** Height the box is never smaller than (its `min-h-*` class, in px). */
  minHeightPx: number;
  /** Height the box never exceeds; content past it scrolls. Ignored when
   *  `maxLines` is given. */
  maxHeightPx?: number;
  /** Ceiling in text lines, resolved against THIS element's line box and
   *  padding. The form to use when the type size is not the caller's to know. */
  maxLines?: number;
  /** `false` hands the height back to the layout: the inline height is cleared
   *  and nothing is measured. Defaults to on. */
  enabled?: boolean;
}

/**
 * The ceiling a line count means for one element: its own line box plus its
 * vertical padding, which is the unit `scrollHeight` reports in (content plus
 * padding, no border).
 */
function linesCeilingPx(el: HTMLTextAreaElement, lines: number): number {
  const style = getComputedStyle(el);
  const lineHeight = Number.parseFloat(style.lineHeight);
  const fontSize = Number.parseFloat(style.fontSize);
  // `line-height: normal` is not a number. The browser's own factor for it is
  // about 1.5, which lands near the truth instead of collapsing the box onto
  // its padding.
  const line = Number.isFinite(lineHeight)
    ? lineHeight
    : Number.isFinite(fontSize) ? fontSize * 1.5 : 20;
  const padding =
    (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0);
  return Math.ceil(lines * line + padding);
}

export function useAutoGrow({
  value,
  minHeightPx,
  maxHeightPx,
  maxLines,
  enabled = true,
}: UseAutoGrowOptions) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // A layout that owns the height must not be fighting an inline one, and it
    // must get its own back the moment growth is switched off (a composer that
    // was grown and then stretched would otherwise keep the docked height).
    if (!enabled) {
      el.style.height = '';
      el.style.overflowY = '';
      return;
    }
    // Reset first: `scrollHeight` reports the height the box would need AT its
    // current size, so measuring without collapsing would never shrink the box
    // back down after a deletion.
    el.style.height = 'auto';
    const ceiling = maxLines === undefined
      ? maxHeightPx ?? Number.POSITIVE_INFINITY
      : linesCeilingPx(el, maxLines);
    const next = Math.min(Math.max(el.scrollHeight, minHeightPx), ceiling);
    el.style.height = `${next}px`;
    // Scroll only once the content actually exceeds the ceiling.
    el.style.overflowY = el.scrollHeight > ceiling ? 'auto' : 'hidden';
  }, [value, minHeightPx, maxHeightPx, maxLines, enabled]);

  return ref;
}
