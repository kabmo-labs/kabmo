/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The two numbers a run's row shows, in one place.
 *
 * Both are pure, and both are shared by the row's chip and its expansion — two
 * copies is how a duration reads `1m12s` in one place and `72s` in the other.
 */

/** A short elapsed span: `12s`, `1m12s`, `1h04m`. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}

/** A byte count a reader can scan: `48 KB`, `3.1 MB`. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
