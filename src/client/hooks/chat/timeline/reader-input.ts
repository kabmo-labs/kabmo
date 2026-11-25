/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The reader's own input, stamped on the scroller.
 *
 * `handleScroll` cannot tell a reader's upward scroll from a layout CLAMP by
 * looking at `scrollTop` alone: a measurement replacing an estimate with a real
 * height moves the viewport up with nobody behind it, and treating that as the
 * reader taking the viewport back cancelled a jump mid-flight. A wheel, a
 * finger, a pointer or a key is the only signal that separates the two, so the
 * scroller records when one arrived.
 *
 * POINTER TRAVEL is tracked separately, as ACTIVITY rather than intent. While
 * the reader's hand is on the transcript — moving the pointer to select text,
 * reach a row, hover a control — the stream's follow writes stand down; a tail
 * that keeps moving under the selection is the bug. It is deliberately absent
 * from the input stamp: a layout clamp that moves `scrollTop` while the pointer
 * happens to pass over the transcript is still not the reader scrolling back.
 *
 * Wired on the scroller NODE (state, not the ref — the surface is swapped in a
 * commit late), because the event only ever arrives there.
 */

import type { RefObject } from 'preact/compat';
import { useEffect } from 'preact/hooks';

/** Scroll intent: a rising `scrollTop` that follows one of these is the reader's. */
const READER_INPUT_TYPES = ['wheel', 'touchstart', 'touchmove', 'pointerdown', 'keydown'] as const;
/** Reader presence without scroll intent; see the module header. */
const READER_ACTIVITY_TYPES = ['pointermove'] as const;
/** How long after the last input the reader counts as idle again. */
export const READER_ACTIVITY_IDLE_MS = 600;

export function useReaderInputStamp(
  scrollNode: HTMLDivElement | null,
  readerInputAtRef: RefObject<number>,
  readerActiveRef: RefObject<boolean>,
): void {
  useEffect(() => {
    if (!scrollNode) return;
    // Activity is a window, not a latch: the next chunk after the reader stops
    // moving catches the tail up. A latch would leave a stray pointer pass
    // suppressing the stream for the rest of the run.
    let idle: ReturnType<typeof setTimeout> | undefined;
    // A press keeps the window alive until it is released. A text selection can
    // be dragged past the transcript's edge, where no more `pointermove`
    // reaches this node — an idle timer alone would let the tail jump under the
    // drag after 600 ms.
    let held = false;
    const arm = (): void => {
      clearTimeout(idle);
      idle = setTimeout(() => {
        idle = undefined;
        if (!held) readerActiveRef.current = false;
      }, READER_ACTIVITY_IDLE_MS);
    };
    const active = (): void => {
      readerActiveRef.current = true;
      arm();
    };
    const press = (): void => {
      held = true;
      active();
    };
    const release = (): void => {
      held = false;
      arm();
    };
    const note = (): void => {
      readerInputAtRef.current = performance.now();
      active();
    };
    for (const type of READER_INPUT_TYPES) scrollNode.addEventListener(type, note, { passive: true });
    for (const type of READER_ACTIVITY_TYPES) scrollNode.addEventListener(type, active, { passive: true });
    scrollNode.addEventListener('pointerdown', press, { passive: true });
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    return () => {
      for (const type of READER_INPUT_TYPES) scrollNode.removeEventListener(type, note);
      for (const type of READER_ACTIVITY_TYPES) scrollNode.removeEventListener(type, active);
      scrollNode.removeEventListener('pointerdown', press);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      clearTimeout(idle);
      readerActiveRef.current = false;
    };
  }, [scrollNode, readerInputAtRef, readerActiveRef]);
}
