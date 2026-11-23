/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Measuring the mounted window into the layout's height map.
 *
 * Split out of `row-window.ts` so that hook stays under the repo's per-file
 * ceiling; the arithmetic is self-contained (DOM in, slot map out) and the
 * subtlety it encodes is worth its own module.
 *
 * A row's SLOT is its wrapper PLUS the run footer that closes it. The footer is
 * a sibling of the row GROUP — it is a model/duration stamp, not a step of the
 * trace rail, so it cannot live inside the rail's container — which puts it
 * outside the row's own rect. Left out of the layout, the rendered content
 * height depended on which rows were mounted: the row at the window's edge
 * pulled its footer in with it, the total grew by the footer's height, the tail
 * pin followed, and the next frame's window started one row later and dropped
 * it again — measured in Chromium at a run's settle as scrollTop 1938 → 1968 →
 * 1938 with scrollHeight 2236 → 2266 → 2236, i.e. the reported up/down flicker
 * at the end of a stream. The marker (`data-row-footer-for`) is set by
 * `MessageList`; the pad then carries the footer for a row that is unmounted,
 * exactly as it carries the row.
 */

/** A measurement is only adopted when it differs by more than this. */
const MEASURE_EPSILON_PX = 0.5;

export interface RowMeasurement {
  /** At least one slot changed by more than the epsilon. */
  changed: boolean;
  /** A measured row sits at or above the viewport's top, so the content ABOVE
   *  the reader moved. */
  above: boolean;
}

/** Read the mounted rows (and their footers) into `measured`, keyed by row id.
 *
 *  A height survives the row being unmounted and remounted, which is what keeps
 *  the scrollbar steady — so this only ever ADDS or REFRESHES entries. */
export function measureRows(el: HTMLElement, measured: Map<string, number>): RowMeasurement {
  let above = false;
  const slots = new Map<string, number>();
  for (const node of el.querySelectorAll<HTMLElement>('[data-row-id]')) {
    const id = node.dataset.rowId;
    if (!id) continue;
    const rect = node.getBoundingClientRect();
    const height = rect.height;
    // A row measured while hidden reports 0; averaging it in would drag every
    // unmeasured row toward nothing.
    if (height <= 0) continue;
    slots.set(id, height);
    // A row at or above the viewport's top moves the content ABOVE the reader;
    // the tail pin must not follow it (see `skipTailPinRef`).
    if (rect.bottom <= 0) above = true;
  }
  for (const node of el.querySelectorAll<HTMLElement>('[data-row-footer-for]')) {
    const id = node.dataset.rowFooterFor;
    if (!id) continue;
    // Only a mounted row has its footer on screen; an unmounted one takes the
    // slot height recorded when it last was.
    const height = slots.get(id);
    if (height === undefined) continue;
    slots.set(id, height + node.getBoundingClientRect().height);
  }
  let changed = false;
  for (const [id, height] of slots) {
    const previous = measured.get(id);
    if (previous !== undefined && Math.abs(previous - height) <= MEASURE_EPSILON_PX) continue;
    measured.set(id, height);
    changed = true;
  }
  return { changed, above };
}
