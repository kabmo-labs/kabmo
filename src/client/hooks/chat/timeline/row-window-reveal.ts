/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `revealRow` — scroll a row into the middle of the viewport, mounting it if the
 * window does not cover it yet.
 *
 * Split out of `row-window.ts` so that hook stays under the repo's per-file
 * ceiling; the loop is a self-contained piece with its own timing rules, and it
 * talks to the hook only through refs (which is what lets it keep correcting for
 * seconds without a re-render).
 *
 * The landing is never a single write. The rows a jump just mounted are
 * measured on later commits — a tool card's output arrives through a deferred
 * highlight, an image decodes, an accordion opens — and every measurement above
 * the target moves it. Measured here, a fixed short window left a jump to the
 * newest turn 300 px short of the tail: outside `scroll.ts`'s 100 px follow
 * threshold, so the stream silently stopped following after the jump.
 */

import type { RowLayout } from '@/shared/lib/chat/timeline/row-window';
import { rowIndex, rowScrollOffset } from '@/shared/lib/chat/timeline/row-window';

/** How long a reveal keeps correcting after it first moves the viewport. */
const REVEAL_SETTLE_MS = 3000;

/** Consecutive still frames that end a reveal early — the layout has settled. */
const REVEAL_STILL_FRAMES = 10;

/** How long a reveal waits for a row the pager is still bringing in. */
const REVEAL_DEADLINE_MS = 3000;

/**
 * Write a scroll position that is meant to LAND, not to animate.
 *
 * The timeline container carries Tailwind's `scroll-smooth`, and CSS
 * `scroll-behavior` applies to a `scrollTop` ASSIGNMENT too (CSSOM-View:
 * the setter scrolls with `behavior: auto`, which resolves to the element's
 * computed `scroll-behavior`). So `el.scrollTop = target` started a smooth
 * animation, the reveal's correction loop re-targeted it every frame, and the
 * jump was left mid-flight wherever the loop stopped — measured on a
 * 240-message session: the trace walked 9 804 → 6 504 px and stayed there.
 * `behavior: 'instant'` is the one value CSS cannot override.
 */
export function writeScrollTop(el: HTMLElement, top: number): void {
  if (Math.abs(el.scrollTop - top) <= 1) return;
  el.scrollTo({ top, behavior: 'instant' });
}

export interface RevealRowDeps {
  /** The timeline's scroll container, read at call time (it is swapped in late). */
  scrollRef: { current: HTMLDivElement | null };
  idsRef: { current: readonly string[] };
  layoutRef: { current: RowLayout };
  viewportRef: { current: number };
  /** Set when the landing is the newest turn; the tail is an anchor of its own. */
  tailPinRef: { current: boolean };
  /** True while a reveal owns the viewport, so a measurement stands down. */
  revealingRef: { current: boolean };
  /** Bumped per reveal: a superseded one stops writing. */
  generationRef: { current: number };
}

/**
 * Build the reveal function. Every dep is a ref, so the returned function is
 * stable for the life of the hook and never re-creates the loop mid-flight.
 */
export function createRevealRow(deps: RevealRowDeps): (id: string) => Promise<void> {
  return (id: string): Promise<void> => {
    const el = deps.scrollRef.current;
    if (!el) return Promise.resolve();
    const deadline = Date.now() + REVEAL_DEADLINE_MS;
    const settleBy = Date.now() + REVEAL_SETTLE_MS;
    // Supersedes an earlier reveal: two rail clicks in a row must land on the
    // SECOND turn, not race each other to the first one's position.
    const generation = (deps.generationRef.current += 1);
    deps.revealingRef.current = true;
    const { promise, resolve } = Promise.withResolvers<void>();
    let stillFrames = 0;
    let lastTop = -1;
    const finish = (): void => {
      // Only the reveal that still owns the generation clears the flag: a
      // superseded one must not hand the viewport to a correction while its
      // successor is still flying.
      if (generation === deps.generationRef.current) deps.revealingRef.current = false;
      resolve();
    };
    const step = (): void => {
      if (generation !== deps.generationRef.current) {
        finish();
        return;
      }
      const rows = deps.idsRef.current;
      const index = rowIndex(rows, id);
      if (index < 0) {
        // The pager may still be bringing the row in; keep asking until the
        // deadline rather than scrolling to a row that does not exist yet.
        if (Date.now() < deadline) requestAnimationFrame(step);
        else finish();
        return;
      }
      const current = deps.layoutRef.current;
      const view = el.clientHeight || deps.viewportRef.current;
      // The newest turn is the TAIL, not the centre of the last row: that is
      // what the reader means by jumping there, and it is what lets follow mode
      // re-engage (the scroll handler's threshold is 100 px).
      deps.tailPinRef.current = index === rows.length - 1;
      writeScrollTop(
        el,
        deps.tailPinRef.current
          ? Math.max(0, el.scrollHeight - view)
          : rowScrollOffset(current, index, view),
      );
      // A row that was just mounted is measured on a later commit; the
      // corrections land on the MEASURED position rather than the estimate the
      // first write used.
      stillFrames = Math.abs(el.scrollTop - lastTop) <= 1 ? stillFrames + 1 : 0;
      lastTop = el.scrollTop;
      if (stillFrames >= REVEAL_STILL_FRAMES || Date.now() >= settleBy) {
        finish();
        return;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    return promise;
  };
}
