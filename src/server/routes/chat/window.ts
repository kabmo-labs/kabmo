/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Slice a fully loaded message list into the requested tail window.
 *
 * `before` is an exclusive upper bound into the full list; the window is the
 * `limit` messages ending just before it. A pending `new-…` session or a fresh
 * spawn has no index to continue from, so the tail is the only window.
 */
export function windowMessages<T>(
  messages: T[],
  limit: number | null,
  before: number | null,
): { messages: T[]; total: number; hasMore: boolean; oldestIndex: number } {
  const total = messages.length;
  if (limit === null || total <= limit) {
    return { messages, total, hasMore: false, oldestIndex: 0 };
  }
  const end = before !== null && before > 0 && before <= total ? before : total;
  const start = Math.max(0, end - limit);
  return { messages: messages.slice(start, end), total, hasMore: start > 0, oldestIndex: start };
}
