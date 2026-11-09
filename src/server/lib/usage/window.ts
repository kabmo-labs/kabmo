/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The USD window shape every provider-reported credit source produces
 * (OpenRouter's key limits, a New API gateway's billing endpoints, …).
 *
 * One builder: `remaining` means the same thing on every card, and a
 * vendor-specific copy drifts the moment one of them is "fixed".
 */

import type { UsageLimitWindow, UsageWindowStatus } from '@/shared/types';

/** A finite number from a JSON value, including the numeric strings vendors send. */
export function num(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/** Status for a credit window: exhausted at zero remaining, else ok. */
function balanceStatus(remaining: number | undefined): UsageWindowStatus {
  if (remaining === undefined) return 'unknown';
  return remaining <= 0 ? 'exhausted' : 'ok';
}

/** One USD window from a balance; `limit` is omitted when the vendor has none. */
export function usdWindow(input: {
  id: string;
  label: string;
  used?: number;
  limit?: number;
  remaining?: number;
  note?: string;
}): UsageLimitWindow {
  const usedFraction = input.limit && input.limit > 0 && input.used !== undefined
    ? input.used / input.limit
    : undefined;
  return {
    id: input.id,
    label: input.label,
    unit: 'usd',
    status: balanceStatus(input.remaining),
    ...(input.used !== undefined ? { used: input.used } : {}),
    ...(input.limit !== undefined ? { limit: input.limit } : {}),
    ...(input.remaining !== undefined ? { remaining: input.remaining } : {}),
    ...(usedFraction !== undefined ? { usedFraction } : {}),
    ...(input.note ? { notes: [input.note] } : {}),
  };
}
