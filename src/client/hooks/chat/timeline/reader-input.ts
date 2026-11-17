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
 * Wired on the scroller NODE (state, not the ref — the surface is swapped in a
 * commit late), because the event only ever arrives there.
 */

import type { RefObject } from 'preact/compat';
import { useEffect } from 'preact/hooks';

const READER_INPUT_TYPES = ['wheel', 'touchstart', 'touchmove', 'pointerdown', 'keydown'] as const;

export function useReaderInputStamp(
  scrollNode: HTMLDivElement | null,
  readerInputAtRef: RefObject<number>,
): void {
  useEffect(() => {
    if (!scrollNode) return;
    const note = (): void => {
      readerInputAtRef.current = performance.now();
    };
    for (const type of READER_INPUT_TYPES) scrollNode.addEventListener(type, note, { passive: true });
    return () => {
      for (const type of READER_INPUT_TYPES) scrollNode.removeEventListener(type, note);
    };
  }, [scrollNode, readerInputAtRef]);
}
