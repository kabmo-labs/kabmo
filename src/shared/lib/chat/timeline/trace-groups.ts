/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * How the timeline's rows are grouped for the `trace` rail.
 *
 * A rail belongs to a RUN, not to a row and not to a block. omp writes one turn
 * as several rows — thinking + tool calls, a notice, then the answer — so a line
 * drawn per row (or per block) breaks at every boundary: measured in the browser
 * on the 39-call sample session, per-block segments left gaps of 256px and 99px
 * between the thinking block, the tool section and the notice.
 *
 * A run is therefore "the consecutive non-user rows", and a user row closes it.
 * That is the whole rule, and it is PURE — the timeline groups its rows here and
 * draws one rail per group, so the decision can be tested without mounting a
 * timeline (which is heavy enough to disturb the runner's file loading).
 */

import type { ChatMessageData } from '@/shared/types/chat';
import { isNoticeRow } from '@/shared/lib/chat/notice-row';

export interface TraceGroup {
  /**
   * Render key: the id of the row that STARTS the run — which is the window's
   * first row only when the window happens to begin at the run's first row.
   *
   * It used to be `rows[0]` unconditionally, and that is what made a block
   * inside a run collapse the moment it was expanded. The timeline mounts a
   * WINDOW of rows, so every measurement that moved the window's `start` by one
   * row renamed the group; a renamed `key` remounts the whole run, and a
   * remount throws away every block's local state — the thinking accordion's
   * own `useState` included, which is why expanding a thought snapped shut
   * again (measured in the browser: one click removed and re-added all 14 rows
   * of the run). A key derived from the run's first row is the same string for
   * every window that covers part of that run.
   */
  key: string;
  /** Indices into the caller's `messages` array, in order. */
  rows: number[];
  /**
   * Whether this group draws a rail. A run of pure prose draws none — a line
   * beside an answer that has no steps would claim a sequence that is not there.
   */
  trace: boolean;
}

/** Whether a row contributes a node: a notice, thinking, or tool calls. */
export function hasTraceContent(msg: ChatMessageData): boolean {
  if (isNoticeRow(msg)) return true;
  if (msg.thinking || msg.monologue) return true;
  return Boolean((msg.toolCalls?.length ?? 0) || (msg.actions?.length ?? 0) || (msg.actions2?.length ?? 0));
}

/**
 * The absolute index where the run containing `index` begins: the first row
 * after the previous user row. Walks back past the window's own `start`,
 * because the key must not depend on where the window happens to begin.
 */
function runStartIndex(messages: ChatMessageData[], index: number): number {
  let cursor = index;
  while (cursor > 0 && messages[cursor - 1].role !== 'user') cursor -= 1;
  return cursor;
}

/**
 * Group `messages[start, end)` into render units.
 *
 * A user row is its own unit; every other row joins the run above it. The
 * group's `trace` is the OR of its rows' trace content, so a run whose steps sit
 * on one row and whose answer sits on the next still draws one line across both.
 *
 * A truncated run keeps the key of its FIRST row, outside the window included —
 * see `TraceGroup.key`.
 */
export function groupTraceRows(messages: ChatMessageData[], start = 0, end = messages.length): TraceGroup[] {
  const groups: TraceGroup[] = [];
  const last = Math.min(end, messages.length);
  for (let idx = start; idx < last; idx++) {
    const msg = messages[idx];
    if (msg.role === 'user') {
      groups.push({ key: msg.id, rows: [idx], trace: false });
      continue;
    }
    const open = groups[groups.length - 1];
    if (open && messages[open.rows[0]].role !== 'user') {
      open.rows.push(idx);
      open.trace = open.trace || hasTraceContent(msg);
      continue;
    }
    groups.push({ key: messages[runStartIndex(messages, idx)].id, rows: [idx], trace: hasTraceContent(msg) });
  }
  return groups;
}
