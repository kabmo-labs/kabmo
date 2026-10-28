/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The search result list as a FLAT, measurable sequence — the arithmetic the
 * panel needs to paint only the rows on screen.
 *
 * A search for a common word returns tens of thousands of hits, and every one
 * of them used to become a DOM node with its own syntax-highlighted markup
 * (measured on this repo: 19,376 rows, 385,706 nodes, 34 s of blocked main
 * thread for one scroll gesture). The rows are therefore laid out here, away
 * from the DOM, so the renderer can ask "which indices are visible?" and mount
 * only those.
 *
 * Two properties make the layout EXACT rather than estimated, and both come
 * from the row markup:
 *
 * - Every row is a single line. A hit is `truncate`d and a group header is one
 *   flex line, so all rows of a kind are the same height.
 * - The heights themselves are measured once from the real DOM
 *   (`Results.tsx`) and passed in, so a font or zoom change is picked up
 *   instead of being frozen into a constant.
 *
 * Gaps live here too, as part of each row's own height, because the virtualized
 * list cannot use `space-y-*`: a CSS margin between siblings only applies to
 * siblings that exist, and a windowed list has a different set of siblings on
 * every scroll.
 */

import type { SearchResultItem } from '@/shared/types/fs';

/** One rendered line of the result list. */
export type SearchListEntry =
  | { kind: 'group'; file: string; count: number }
  | { kind: 'hit'; file: string; result: SearchResultItem; /** Last hit of its file. */ last: boolean };

/** A file and its hits, in the order the server streamed them. */
export interface SearchGroup {
  file: string;
  results: readonly SearchResultItem[];
}

/** The measured content height of each row kind, in px. */
export interface SearchRowMetrics {
  headerBox: number;
  hitBox: number;
}

/**
 * The gaps the rows used to get from `space-y-1` / `space-y-4` / `mb-1`, now
 * folded into each row's height. They are layout, not measurement, so they stay
 * constants — only the text boxes are measured.
 */
export const SEARCH_ROW_GAPS = {
  /** Below a group header (`mb-1`). */
  header: 4,
  /** Between two hits of the same file (`space-y-1`). */
  hit: 4,
  /** Between two files (`space-y-4`). */
  group: 16,
} as const;

/** Row heights that are correct before the first measurement lands. */
export const DEFAULT_SEARCH_ROW_METRICS: SearchRowMetrics = { headerBox: 16, hitBox: 20 };

/**
 * The most matches one run will deliver.
 *
 * A common word matches tens of thousands of lines in a real workspace —
 * measured on this repo, `const` produced 19,376 hits and a 3 MB SSE payload,
 * which is memory and bandwidth spent on results nobody reads past the first
 * screenful. The server stops the run here and says so, and the panel prints
 * the same number, so the cap cannot be described differently in two places.
 */
export const MAX_SEARCH_RESULTS = 5000;

/**
 * Group hits by file, keeping the order the server streamed them in.
 *
 * Streaming order is the order ripgrep walked the tree, so a group appears the
 * moment its first hit does and the list stays stable as more frames land —
 * re-sorting by path would make every arriving frame move the rows already on
 * screen.
 */
export function groupSearchResults(results: readonly SearchResultItem[]): SearchGroup[] {
  const groups: SearchGroup[] = [];
  let current: { file: string; results: SearchResultItem[] } | null = null;
  for (const result of results) {
    if (!current || current.file !== result.file) {
      current = { file: result.file, results: [] };
      groups.push(current);
    }
    current.results.push(result);
  }
  return groups;
}

/** Flatten `[file, hits][]` into the exact sequence the list renders. */
export function buildSearchRows(groups: readonly SearchGroup[]): SearchListEntry[] {
  const rows: SearchListEntry[] = [];
  for (const group of groups) {
    rows.push({ kind: 'group', file: group.file, count: group.results.length });
    for (let i = 0; i < group.results.length; i++) {
      rows.push({ kind: 'hit', file: group.file, result: group.results[i], last: i === group.results.length - 1 });
    }
  }
  return rows;
}

/** One row's height, including the gap that follows it. */
export function searchRowHeight(entry: SearchListEntry, metrics: SearchRowMetrics): number {
  if (entry.kind === 'group') return metrics.headerBox + SEARCH_ROW_GAPS.header;
  return metrics.hitBox + (entry.last ? SEARCH_ROW_GAPS.group : SEARCH_ROW_GAPS.hit);
}

/**
 * The top offset of every row, plus the total content height.
 *
 * `offsets[i]` is the row's own top; `total` is the last row's offset plus its
 * height, which is what the spacer is sized to so the scrollbar reflects the
 * whole result set rather than the mounted window.
 */
export function layoutSearchRows(
  rows: readonly SearchListEntry[],
  metrics: SearchRowMetrics,
): { offsets: number[]; heights: number[]; total: number } {
  const offsets = new Array<number>(rows.length);
  const heights = new Array<number>(rows.length);
  let cursor = 0;
  for (let i = 0; i < rows.length; i++) {
    const height = searchRowHeight(rows[i], metrics);
    offsets[i] = cursor;
    heights[i] = height;
    cursor += height;
  }
  return { offsets, heights, total: cursor };
}

/**
 * The half-open index range to mount for a viewport.
 *
 * `scrollTop` is measured in the SPACER's coordinates (the caller subtracts the
 * container's own padding), so the range is independent of how the scroller is
 * decorated. `overscan` extends the range on both sides so a fast flick does
 * not outrun the mount and show a blank band.
 *
 * The search is a binary search on the prefix sums, so the cost is
 * O(log n) regardless of how many hits the query produced.
 */
export function searchWindow(
  offsets: readonly number[],
  heights: readonly number[],
  scrollTop: number,
  viewport: number,
  overscan = 240,
): { start: number; end: number } {
  if (offsets.length === 0) return { start: 0, end: 0 };
  // A rubber-band scroll can report a negative offset; the content has nothing
  // above its first row, so the window is measured from the top.
  const top = Math.max(0, scrollTop);
  const from = top - overscan;
  const to = top + viewport + overscan;

  // First row whose bottom edge is past `from`.
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid] + heights[mid] > from) hi = mid;
    else lo = mid + 1;
  }
  const start = lo;

  // First row that starts at or past the window's bottom edge — it and
  // everything after it is outside. A row beginning exactly at the edge has no
  // overlap with the viewport, so the bound is inclusive of the offset.
  lo = start;
  hi = offsets.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid] >= to) hi = mid;
    else lo = mid + 1;
  }
  return { start, end: lo };
}
