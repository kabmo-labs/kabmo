/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Formatting for the Stats panel.
 *
 * Pure functions in their own module because every one of them encodes a
 * decision that is invisible at the call site and wrong in a way a reader would
 * not notice: a byte count that rounds 0.4 MB to `0 MB`, a CPU percent that
 * prints `0.0%` for "no measurement yet", a label that reads
 * `daemon:omp.browser.headless` in a table cell.
 */


/** Bytes as a compact human string, with one decimal past a kilobyte. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  // Bytes and kilobytes read better whole; past that one decimal is the
  // difference between "1.5 GB" and a number nobody can scan.
  return unit <= 1 ? `${Math.round(value)} ${units[unit]}` : `${value.toFixed(1)} ${units[unit]}`;
}

/**
 * A CPU percent, or `—` when there is no measurement.
 *
 * `null` is a REAL state — the first sample, or a process that appeared since
 * the last one — and printing `0.0%` for it would claim the process is idle.
 * The distinction is the whole reason `cpuPercent` is nullable.
 */
export function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  // A single core's worth of work is 100%; more means threads in parallel.
  return value >= 100 ? `${Math.round(value)}%` : `${value.toFixed(1)}%`;
}

/** A short time-ago label for a sample stamp. */
export function formatAge(sampledAt: number, now: number): string {
  if (!Number.isFinite(sampledAt) || sampledAt <= 0) return 'never';
  const seconds = Math.max(0, Math.round((now - sampledAt) / 1000));
  if (seconds < 2) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ago`;
}

/**
 * A byte count as the NAVBAR reads it: `2.5G`, `512M`, `0B`.
 *
 * The panel's own `formatBytes` spells the unit out (`2.5 GB`) because a table
 * has a column header and room to be unambiguous. A header readout sits beside
 * the context ring and the window controls, so it is two characters of unit and
 * one decimal — the same number, in the space it has.
 *
 * Megabytes and below stay whole: `512M` is already precise enough that a
 * decimal would be a digit the reader cannot act on, and a sub-megabyte figure
 * that printed `0G` would read as nothing at all.
 */
export function formatCompactBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0B';
  const units = ['B', 'K', 'M', 'G', 'T'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  if (unit <= 2) return `${Math.round(value)}${units[unit]}`;
  // One decimal, and `.0` trimmed: `2G` rather than `2.0G` — the trailing zero
  // is a character the header pays for and nobody reads.
  const rounded = value.toFixed(1).replace(/\.0$/, '');
  return `${rounded}${units[unit]}`;
}

/**
 * A CPU percent as the navbar reads it: `18%`, `140%`, `—`.
 *
 * `null` stays a dash for the reason `formatPercent` gives — the first sample
 * has no rate, and `0%` would claim the stack is idle. A header is worse than a
 * table here: nobody scrolls a navbar looking for the footnote that says the
 * figure is not a measurement.
 */
export function formatCompactPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${Math.round(value)}%`;
}
