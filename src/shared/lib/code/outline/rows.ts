/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * How much of an outline a panel is allowed to draw, and when it is not drawn
 * at all.
 *
 * Both bounds exist because a large file's outline is not a long list — it is a
 * DOM. Measured in the browser on a 10 MB source file with 63 618 declarations:
 * **446 308 DOM nodes, 415 MB of JS heap, and 953 ms per keystroke** while the
 * panel was on screen (the editor's own cost is 34 ms). Expanding the section
 * took 2.7 s. The scan is not the problem — it is 366 ms in Bun, once per pause
 * — the ROWS are.
 *
 * Two answers, and they are different questions:
 *
 * - **`MAX_OUTLINE_ROWS` caps the list.** An outline is a map you scan by eye or
 *   jump from; nobody reads 63 000 rows, and the panel says how many it is not
 *   showing rather than silently truncating. Same shape as the search panel's
 *   `MAX_SEARCH_RESULTS`.
 * - **`MAX_OUTLINE_SCAN_CHARS` skips the scan above a size where it costs more
 *   than the list is worth.** At 10 MB a scan is ~366 ms of blocked main thread
 *   every time the buffer settles, which is a stutter per typing pause. The
 *   sentence says so instead of leaving the panel empty, which would read as
 *   "this file has no declarations".
 *
 * The size is counted in CODE UNITS (`content.length`), not bytes: measuring
 * UTF-8 bytes would mean encoding the whole buffer to answer a guard, and for
 * the ASCII that dominates source files the two numbers are the same. A file of
 * multibyte characters therefore trips the guard slightly early — the safe
 * direction.
 */

import type { OutlineSymbol } from '@/shared/lib/code/outline/types';

/**
 * Rows a panel renders. Past this the list is truncated with a count, not
 * silently shortened.
 */
export const MAX_OUTLINE_ROWS = 500;

/** Buffer size above which the outline is not scanned at all. */
/**
 * Buffer size above which the outline is not scanned at all.
 *
 * The scan is one blocked stretch of main thread after each typing pause, and it
 * measured 38 ms at 1 MB, 160 ms at 5 MB, 262 ms at 10 MB and 519 ms at 20 MB —
 * linear in the buffer. 8 MiB keeps that pause under ~210 ms, which is less than
 * the debounce that schedules it and therefore reads as "the list settled"
 * rather than as a stutter.
 *
 * Past it the panel says the file is too large to outline instead of scanning
 * it: a declaration list for a 30 MB file is not worth a half-second freeze on
 * every pause, and an empty list would read as "no declarations here".
 */
export const MAX_OUTLINE_SCAN_CHARS = 8 * 1024 * 1024;

export interface OutlineWindow {
  /** The rows to render — at most `MAX_OUTLINE_ROWS`. */
  rows: OutlineSymbol[];
  /** Symbols the scan actually found, including the ones not rendered. */
  total: number;
  /** True when `rows` is shorter than `total`. */
  truncated: boolean;
}

/**
 * The rows a panel should render, and whether it is showing all of them.
 *
 * Source order is preserved: an outline is a map of a document, so the first N
 * declarations are the top of the file rather than an arbitrary sample.
 */
export function outlineWindow(symbols: readonly OutlineSymbol[]): OutlineWindow {
  const total = symbols.length;
  if (total <= MAX_OUTLINE_ROWS) return { rows: symbols as OutlineSymbol[], total, truncated: false };
  return { rows: symbols.slice(0, MAX_OUTLINE_ROWS), total, truncated: true };
}

/** The sentence printed under a truncated list. */
export function outlineTruncatedNotice(total: number): string {
  return `Showing the first ${MAX_OUTLINE_ROWS.toLocaleString()} of ${total.toLocaleString()} symbols.`;
}

/**
 * The sentence a panel prints instead of rows when the buffer is past the scan
 * ceiling, or null when it is not.
 */
export function outlineTooLargeNotice(contentLength: number): string | null {
  if (contentLength <= MAX_OUTLINE_SCAN_CHARS) return null;
  const mb = contentLength / (1024 * 1024);
  return `This file is ${mb.toFixed(1)} MB — too large to outline.`;
}
