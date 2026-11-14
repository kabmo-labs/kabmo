/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Wall-clock span label for statistics.
 *
 * Sub-second is the point: a fast tool call or a short LLM request is a real
 * measurement, while the chat footer's `formatDuration` deliberately hides
 * anything under a second. `formatSpan` prints `0.4s`, `12s`, `2m 14s`,
 * `1h 4m` — one convention for every timing row in the context popover.
 *
 * Undefined, non-finite and non-positive values return `undefined`, so the
 * caller omits the row instead of printing a measurement the source never made.
 */
export function formatSpan(ms: number | undefined): string | undefined {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return undefined;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
