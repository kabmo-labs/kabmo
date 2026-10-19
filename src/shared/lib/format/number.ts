/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared number formatters. Every compact-label / cost / byte / price display
 * in Kabmo funnels through here so the wire format stays identical
 * everywhere.
 *
 * `formatCompactTokens` absorbs the former `formatContextWindow` (the most
 * complete of the token formatters — it accepts a raw number, an already
 * formatted string, or null/undefined). Call sites that always need a string
 * pass a `?? '0'` fallback.
 */

/**
 * Compact token/context label using decimal (1000-based) units:
 * 1500 → "1.5K", 1048576 → "1.0M", 131072 → "131.1K". Strings pass through
 * unchanged (already formatted); non-finite or non-positive numbers return
 * `undefined`.
 */
export function formatCompactTokens(value: number | string | undefined | null): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value;
  if (!Number.isFinite(value) || value <= 0) return undefined;

  if (value >= 1_000_000) {
    const m = value / 1_000_000;
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M`;
  }
  if (value >= 1_000) {
    const k = value / 1_000;
    return `${Number.isInteger(k) ? k : k.toFixed(1)}K`;
  }
  return String(value);
}

/**
 * Dollar amount (`$1.23`). Non-finite or non-positive values return an empty
 * string so call sites can omit the cost entirely; callers that need a zero
 * label (chart axes) fall back with `|| '$0.00'`. `fractionDigits` defaults to
 * the 2-decimal display and is raised by subagent rows that report sub-cent
 * costs.
 */
export function formatCost(value: number | undefined | null, fractionDigits = 2): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '';
  return `$${value.toFixed(fractionDigits)}`;
}

/**
 * Byte size label: 0 → "0 B", 512 → "512 B", 2048 → "2.0 KB", 2 MiB → "2.00 MB".
 * Undefined, non-finite, or negative values return an empty string.
 */
export function formatBytes(bytes: number | undefined | null): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Per-1M-token price label (`$3.00`). Undefined/non-finite/negative values
 * return an empty string so a partially specified model renders one side blank.
 */
export function formatPrice(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '';
  return `$${value.toFixed(2)}`;
}
