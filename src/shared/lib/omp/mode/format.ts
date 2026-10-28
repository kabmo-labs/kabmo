/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Compact figures for a goal's tokens and time.
 *
 * The composer's goal row and the timeline's goal card read the same record, so
 * the arithmetic lives here rather than in either component — two spellings of
 * "1.5k" is how a status strip starts disagreeing with the card it summarizes.
 */

/** `451800` → `452k`, `1500` → `1.5k`, `900` → `900`. One decimal below 10k:
 *  the digit is what distinguishes 12.3k from 12.8k, and nothing above it. */
export function formatGoalTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${trimZero(tokens / 1_000_000)}M`;
  if (tokens >= 1_000) {
    const thousands = tokens / 1_000;
    return `${trimZero(thousands >= 10 ? Math.round(thousands) : thousands)}k`;
  }
  return String(Math.round(tokens));
}

function trimZero(value: number): string {
  const fixed = value.toFixed(1);
  return fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed;
}

/** `45` → `45s`, `3700` → `1h 1m`, `90` → `1m`. */
export function formatGoalDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
