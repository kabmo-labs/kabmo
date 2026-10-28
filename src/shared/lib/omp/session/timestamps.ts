/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Timestamp normalization for omp entries. omp writes timestamps as either an
 * epoch-millis number or an ISO string depending on version, so both the live
 * SSE mapper and the JSONL reload path normalize through here.
 */

/** Epoch millis from an epoch-millis number or a parseable date string. */
export function toEpochMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const t = new Date(value).getTime();
    return Number.isNaN(t) ? undefined : t;
  }
  return undefined;
}
