/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The timeline as a MEASURABLE sequence, so the list can mount only the rows
 * around the viewport.
 *
 * The timeline used to mount every row it had ever loaded. Paging history with
 * `?before=` prepends to the same array and nothing is ever released, so a
 * long session accumulated DOM for every page the reader had scrolled through —
 * measured on this machine (production bundle, WebKit, a 9.4 MB session): 10
 * pages = 107 807 nodes and 891 MB of WebContent footprint, none of it released
 * when the reader scrolled away, and ~5.5 MB per 1 000 nodes. Reloading the
 * same session brought it back to 11 438 nodes, which is what says the cost is
 * the mounted rows rather than the data.
 *
 * Rows have no fixed height — a user bubble, a thinking accordion and a tool
 * card with 1 000 lines of output are all one row — so the layout is built from
 * MEASURED heights with an average-based estimate for the ones that have never
 * been mounted. Everything here is arithmetic over ids and numbers; the DOM
 * half (measuring, scrolling, the reveal) lives in the client hook.
 */

/** Height assumed for a row nobody has measured yet, before any average exists. */
export const DEFAULT_ROW_HEIGHT = 120;

/**
 * Pixels mounted beyond the viewport on each side.
 *
 * One viewport-and-a-half: enough that a flick or a smooth scroll does not
 * outrun the mount and show a blank band, small enough that a tall session
 * still holds a bounded number of rows.
 */
export const ROW_WINDOW_OVERSCAN_PX = 900;

export interface RowLayout {
  /** The top of every row, in px, in spacer coordinates. */
  offsets: Float64Array;
  /** The height of every row, in px. */
  heights: Float64Array;
  /** The whole content height: the last row's offset plus its height. */
  total: number;
  /** The height used for rows with no measurement (the measured average). */
  estimate: number;
}

/**
 * The height to assume for a row that has never been mounted.
 *
 * The measured average rather than a constant: rows in one session are mostly
 * of one kind (tool cards in a run, prose in another), so the average is the
 * estimate with the least error — and it corrects itself as the reader scrolls.
 * A single constant put every unmeasured row at 120 px, which made a session of
 * tall tool cards scroll as if it were half its height.
 */
export function averageRowHeight(measured: ReadonlyMap<string, number>): number {
  // A row measured while hidden reports 0; averaging it in would drag every
  // unmeasured row toward nothing, so only real heights count.
  let sum = 0;
  let count = 0;
  for (const height of measured.values()) {
    if (height <= 0) continue;
    sum += height;
    count += 1;
  }
  return count === 0 ? DEFAULT_ROW_HEIGHT : sum / count;
}

/**
 * Lay the rows out top to bottom.
 *
 * `measured` is keyed by row id, so a height survives the row being unmounted
 * and remounted — which is what keeps the scrollbar steady while the reader
 * moves through a long session.
 */
export function layoutTimelineRows(
  ids: readonly string[],
  measured: ReadonlyMap<string, number>,
  estimate: number = averageRowHeight(measured),
): RowLayout {
  const count = ids.length;
  const offsets = new Float64Array(count);
  const heights = new Float64Array(count);
  let cursor = 0;
  for (let i = 0; i < count; i++) {
    const known = measured.get(ids[i]);
    const height = known !== undefined && known > 0 ? known : estimate;
    offsets[i] = cursor;
    heights[i] = height;
    cursor += height;
  }
  return { offsets, heights, total: cursor, estimate };
}

export interface TimelineWindow {
  /** First mounted row index (inclusive). */
  start: number;
  /** Last mounted row index (exclusive). */
  end: number;
  /** Spacer height above the mounted rows. */
  padTop: number;
  /** Spacer height below the mounted rows. */
  padBottom: number;
}

const EMPTY_WINDOW: TimelineWindow = { start: 0, end: 0, padTop: 0, padBottom: 0 };

/**
 * The half-open range to mount for a viewport.
 *
 * `scrollTop` is in the SPACER's coordinates, so the range does not depend on
 * how the scroller is decorated. A rubber-band scroll can report a negative
 * offset; the content has nothing above its first row, so the window is
 * measured from the top.
 *
 * Both ends are binary searches on the prefix sums, so the cost does not grow
 * with the session.
 */
export function timelineWindow(
  layout: RowLayout,
  scrollTop: number,
  viewport: number,
  overscan: number = ROW_WINDOW_OVERSCAN_PX,
): TimelineWindow {
  const { offsets, heights, total } = layout;
  const count = offsets.length;
  if (count === 0) return EMPTY_WINDOW;

  const top = Math.max(0, scrollTop);
  const from = Math.max(0, top - overscan);
  const to = top + Math.max(0, viewport) + overscan;

  // First row whose bottom edge is past `from`.
  let lo = 0;
  let hi = count - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid] + heights[mid] > from) hi = mid;
    else lo = mid + 1;
  }
  const start = lo;

  // First row that starts at or past the window's bottom edge — it and
  // everything after it is outside, since a row beginning exactly at the edge
  // does not overlap the viewport.
  lo = start;
  hi = count;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid] >= to) hi = mid;
    else lo = mid + 1;
  }
  const end = Math.max(start + 1, Math.min(lo, count));

  const padTop = offsets[start];
  const lastBottom = offsets[end - 1] + heights[end - 1];
  return { start, end, padTop, padBottom: Math.max(0, total - lastBottom) };
}

/**
 * The scroll offset that centres row `index` in the viewport.
 *
 * Clamped to the content, because a row near either end cannot be centred and
 * an unclamped write would be silently truncated by the browser anyway.
 */
export function rowScrollOffset(layout: RowLayout, index: number, viewport: number): number {
  if (index < 0 || index >= layout.offsets.length) return 0;
  const top = layout.offsets[index];
  const height = layout.heights[index];
  const centred = top - (viewport - height) / 2;
  return Math.max(0, Math.min(centred, Math.max(0, layout.total - viewport)));
}

/** Index of `id` in `ids`, or -1. */
export function rowIndex(ids: readonly string[], id: string): number {
  for (let i = ids.length - 1; i >= 0; i--) {
    if (ids[i] === id) return i;
  }
  return -1;
}
