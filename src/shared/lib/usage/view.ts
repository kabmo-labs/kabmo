/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Formatting and the headline metric set for the Token Usage panel.
 *
 * Nothing here divides or averages: the panel reports ONE period, so every
 * figure is that period's total. A cadence switch used to exist beside the
 * period switch, and a period total cannot move when days are regrouped — which
 * made the control look broken. The period IS the switch now.
 *
 * Pure and shared, so the panel's components hold no arithmetic.
 */

import type { TokenUsageMetricSet, UsageCounters, UsageTotals } from '@/shared/types';

/**
 * `$1.23` for a cost row, `< $0.01` for a real but sub-cent amount.
 *
 * Rounding a nonzero cost to `$0.00` reads as "this was free", which is the
 * one thing an unpriced/free provider is NOT. `<$0.01` says the cost exists
 * and is below the display precision.
 */
export function costLabel(value: number, fractionDigits = 2): string {
  if (value > 0 && Number(value.toFixed(fractionDigits)) === 0) return '< $0.01';
  return `$${value.toFixed(fractionDigits)}`;
}

/** Compact token count with decimal units, matching the rest of the app. */
export function tokenLabel(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
}

/** Cache-hit percentage over observed input (cache read + uncached input). */
export function cacheHitRate(counters: Pick<UsageCounters, 'cacheRead' | 'input'>): number | null {
  const observed = counters.cacheRead + counters.input;
  return observed > 0 ? counters.cacheRead / observed : null;
}

/** `98.7%` or `—` when nothing was cached or read. */
export function cacheHitLabel(counters: Pick<UsageCounters, 'cacheRead' | 'input'>): string {
  const rate = cacheHitRate(counters);
  return rate === null ? '—' : `${(rate * 100).toFixed(1)}%`;
}

/** `$0.07` per 1M tokens, or `—` when no tokens were processed. */
export function costPerMillionLabel(counters: Pick<UsageCounters, 'cost' | 'tokens'>): string {
  if (counters.tokens <= 0) return '—';
  return `$${((counters.cost / counters.tokens) * 1_000_000).toFixed(2)}`;
}

/** The headline tiles, as display strings for the selected period. */
export function toMetricSet(totals: UsageTotals): TokenUsageMetricSet {
  return {
    rawCost: costLabel(totals.cost),
    costPerMillion: costPerMillionLabel(totals),
    processedTokens: tokenLabel(totals.tokens),
    activeRate: `${totals.activeDays} active ${totals.activeDays === 1 ? 'day' : 'days'}`,
    cachedInput: tokenLabel(totals.cacheRead),
    cachedPercent: `${cacheHitLabel(totals)} of observed input`,
    uncachedInput: tokenLabel(totals.input),
    cacheWrite: tokenLabel(totals.cacheWrite),
    outputTokens: tokenLabel(totals.output),
    reasoning: `${tokenLabel(totals.reasoning)} reasoning`,
    records: totals.records,
    unpricedRecords: totals.unpriced,
  };
}
