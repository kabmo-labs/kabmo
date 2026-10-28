/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Serve a CONTENTS row inside a rendered preview.
 *
 * A preview draws no code surface and has no lines, so the line request the
 * outline uses in source mode has nothing to move — and forcing the reader back
 * to the source to satisfy it is the wrong answer for a document they are
 * reading. A row therefore scrolls the rendered document to its heading, and the
 * reader stays exactly where they are.
 *
 * Four rules, each a way this fails silently:
 *
 * 1. **The match is by NORMALIZED text, then by occurrence.** The row's name is
 *    the source's spelling (`Hello **world**`) and the rendered heading's text
 *    is the rendered one (`Hello world`); comparing them raw matches nothing.
 *    Duplicate headings are ordinary, and a plain `find` always answers the
 *    first — so the nth row goes to the nth heading.
 * 2. **The ordinal is the fallback, never the first choice.** Inline markup can
 *    normalize differently from what the renderer prints; landing on the row's
 *    own position is a near miss, landing nowhere is a dead control.
 * 3. **The scroll is a RECT delta, not `offsetTop`.** The scroller is
 *    `overflow-auto` but not positioned, so a heading's `offsetTop` is measured
 *    against whichever ancestor happens to be positioned — a number that drifts
 *    the moment the preview's wrapper gains a layout class.
 * 4. **A reveal cancels the tab's pending scroll restore.** `useScrollRestore`
 *    replays for ~600 ms while the document settles; without the cancel it
 *    writes the remembered offset back over the jump (measured in the source
 *    surface: a jump to 34 695 px was reverted to 0 375 ms later).
 */

import { useEffect } from 'preact/hooks';
import { useSyncExternalStore } from 'preact/compat';
import { cancelScrollRestore } from '@/client/hooks/editor/use-scroll-restore';
import { getHeadingReveal, setHeadingReveal, subscribeHeadingReveal } from '@/client/lib/heading-reveal';
import { findHeadingIndex } from '@/shared/lib/markdown/headings';

/** Space left above the heading, so it does not sit against the scroller's edge. */
export const HEADING_JUMP_PAD_PX = 12;

export interface UseHeadingJumpOptions {
  /** The document on screen, so a request for another file stays pending. */
  path: string | null;
  /** The preview's own scroller; null until the preview has mounted. */
  scroller: HTMLElement | null;
  /** The rendered view is what is on screen. A source view serves line requests. */
  preview: boolean;
}

export function useHeadingJump({ path, scroller, preview }: UseHeadingJumpOptions): void {
  const reveal = useSyncExternalStore(subscribeHeadingReveal, getHeadingReveal);

  // No dependency list: the two conditions that unblock a jump — the preview
  // mounting and the request arriving — are not values this hook owns, and a
  // missed render is a click that silently did nothing.
  useEffect(() => {
    if (!reveal || !path || reveal.path !== path) return;
    // A SOURCE view is on screen, and it serves LINE requests — so this one
    // stays pending rather than being cleared or applied against a code surface
    // where a heading index means nothing. `useLineJump` follows the same rule
    // for a missing surface.
    if (!preview || !scroller) return;

    const headings = [...scroller.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')];
    const index = findHeadingIndex(
      headings.map((heading) => heading.textContent ?? ''),
      reveal,
    );
    const target = headings[index];
    // No heading matched: the preview is still settling (its content arrives a
    // frame after the scroller), so the request stays pending and the next
    // render asks again. Clearing here would drop a click that was about to be
    // servable — the same rule `useLineJump` applies to a missing surface.
    if (!target) return;

    cancelScrollRestore(scroller);
    const delta = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    scroller.scrollTop += delta - HEADING_JUMP_PAD_PX;
    setHeadingReveal(null);
  });
}
