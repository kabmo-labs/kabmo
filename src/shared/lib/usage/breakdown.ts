/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Token Usage breakdown and chart view models.
 *
 * Everything here re-folds data the client ALREADY holds: the payload carries
 * the period's daily rows, so the tab switch costs no request, and the chart's
 * bucket width follows the period's own length (`granularityFor`).
 *
 * Two rules that were bugs before:
 *
 *  - a provider is part of a row's identity, so one model id served by two
 *    accounts is two subtrees rather than one merged cost;
 *  - an unpriced turn is counted per RECORD (tokens, no reported cost), never
 *    folded into a zero cost that reads as "free".
 *
 * There is no per-day/per-week figure anywhere: a period is a period, and every
 * row is that period's total.
 */

import type {
  BreakdownTab,
  BucketGranularity,
  ChartSeriesPoint,
  UsageDayRow,
  UsageProjectRow,
  UsageProviderRow,
  UsageTotals,
} from '@/shared/types';
import { bucketKey, bucketLabel, compareDayKeys, daysInWindow, type DayWindow } from '@/shared/lib/usage/range';
import { cacheHitLabel } from '@/shared/lib/usage/view';

/**
 * Chart points for one granularity, plus the per-provider split the stacked
 * area draws.
 *
 * Buckets are the union of the days present — an empty day inside the range is
 * inserted so the line does not draw a straight diagonal over a gap.
 */
export interface CadenceBucket {
  key: string;
  label: string;
  cost: number;
  tokens: number;
  byProvider: Record<string, { cost: number; tokens: number }>;
}

export function bucketDays(days: readonly UsageDayRow[], granularity: BucketGranularity): CadenceBucket[] {
  const buckets = new Map<string, CadenceBucket>();
  for (const day of days) {
    const key = bucketKey(day.day, granularity);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { key, label: bucketLabel(key, granularity), cost: 0, tokens: 0, byProvider: {} };
      buckets.set(key, bucket);
    }
    bucket.cost += day.cost;
    bucket.tokens += day.tokens;
    for (const [provider, split] of Object.entries(day.providers)) {
      const current = bucket.byProvider[provider] ?? { cost: 0, tokens: 0 };
      current.cost += split.cost;
      current.tokens += split.tokens;
      bucket.byProvider[provider] = current;
    }
  }
  return [...buckets.values()].sort((a, b) => compareDayKeys(a.key, b.key));
}

/** Flat series for the single-line chart. */
export function chartSeries(days: readonly UsageDayRow[], granularity: BucketGranularity): ChartSeriesPoint[] {
  return bucketDays(days, granularity).map((bucket) => ({
    label: bucket.label,
    cost: bucket.cost,
    tokens: bucket.tokens,
  }));
}

/** One row of the breakdown table. */
export interface BreakdownViewRow {
  /** Stable key (provider slug, model id, day bucket, project path). */
  key: string;
  label: string;
  /** Provider slug for the icon plate; absent on day rows. */
  provider?: string;
  /** Model id, when the row belongs to a provider subtree. */
  model?: string;
  /** `group` rows are provider headers in the two-level tree. */
  kind: 'row' | 'group';
  cost: number;
  tokens: number;
  records: number;
  cacheHit: string;
  /** Share of the period cost, 0..100. */
  sharePercent: number;
  /** Share of the parent provider's cost, for model rows under a group. */
  shareOfParentPercent?: number;
  depth: 0 | 1;
}

function shareOf(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;
}

/**
 * The Model tab's two-level tree: each provider, then its models.
 *
 * The provider row is what the panel was missing — `message.provider` was
 * recorded on every usage entry, yet the breakdown keyed on model alone, so
 * two accounts serving `deepseek-v4-1-flash` reported one merged cost
 * ($1 673.86 measured) instead of $1 619.43 + $54.43.
 */
export function providerModelRows(providers: readonly UsageProviderRow[], totalCost: number): BreakdownViewRow[] {
  const rows: BreakdownViewRow[] = [];
  for (const provider of providers) {
    rows.push({
      key: `p:${provider.id}`,
      label: provider.name,
      provider: provider.id,
      kind: 'group',
      cost: provider.cost,
      tokens: provider.tokens,
      records: provider.records,
      cacheHit: cacheHitLabel(provider),
      sharePercent: shareOf(provider.cost, totalCost),
      depth: 0,
    });
    for (const model of provider.models) {
      rows.push({
        key: `m:${provider.id}:${model.model}`,
        label: model.model || 'unknown',
        provider: provider.id,
        model: model.model,
        kind: 'row',
        cost: model.cost,
        tokens: model.tokens,
        records: model.records,
        cacheHit: cacheHitLabel(model),
        sharePercent: shareOf(model.cost, totalCost),
        shareOfParentPercent: shareOf(model.cost, provider.cost),
        depth: 1,
      });
    }
  }
  return rows;
}

/**
 * Time rows for the whole period, oldest first.
 *
 * `window` is the period's own day range: the payload only carries days that
 * saw usage, so without it a quiet Tuesday simply vanished from the table and
 * the list stopped matching the period it claims to describe. A bucket that
 * never carried a record is listed with zeros rather than omitted.
 */
export function dayRows(
  days: readonly UsageDayRow[],
  granularity: BucketGranularity,
  totalCost: number,
  window: DayWindow | null,
): BreakdownViewRow[] {
  const buckets = bucketDays(days, granularity);
  // One pass collects the counters `bucketDays` does not carry (turns and the
  // input split), so no bucket re-scans the day list.
  const extra = new Map<string, { records: number; cacheRead: number; input: number }>();
  for (const day of days) {
    const key = bucketKey(day.day, granularity);
    const current = extra.get(key) ?? { records: 0, cacheRead: 0, input: 0 };
    current.records += day.records;
    current.cacheRead += day.cacheRead;
    current.input += day.input;
    extra.set(key, current);
  }
  // Fill every bucket the window covers, so the table lists the period rather
  // than only the days that happened to carry usage.
  const known = new Set(buckets.map((bucket) => bucket.key));
  for (const day of window ? daysInWindow(window) : []) {
    const key = bucketKey(day, granularity);
    if (known.has(key)) continue;
    known.add(key);
    buckets.push({ key, label: bucketLabel(key, granularity), cost: 0, tokens: 0, byProvider: {} });
  }
  return [...buckets]
    .sort((a, b) => compareDayKeys(a.key, b.key))
    .map((bucket) => {
      const counts = extra.get(bucket.key) ?? { records: 0, cacheRead: 0, input: 0 };
      return {
        key: `d:${bucket.key}`,
        label: bucket.label,
        kind: 'row' as const,
        cost: bucket.cost,
        tokens: bucket.tokens,
        records: counts.records,
        cacheHit: cacheHitLabel(counts),
        sharePercent: shareOf(bucket.cost, totalCost),
        depth: 0 as const,
      };
    });
}

/** Project rows, ordered by cost. */
export function projectRows(projects: readonly UsageProjectRow[], totalCost: number): BreakdownViewRow[] {
  return [...projects]
    .sort((a, b) => b.cost - a.cost)
    .map((project) => ({
      key: `j:${project.project}`,
      label: project.project,
      kind: 'row' as const,
      cost: project.cost,
      tokens: project.tokens,
      records: project.records,
      cacheHit: cacheHitLabel(project),
      sharePercent: shareOf(project.cost, totalCost),
      depth: 0 as const,
    }));
}

/** The rows the active tab shows, with the provider tab reusing the tree. */
export function breakdownRows(
  tab: BreakdownTab,
  payload: {
    totals: UsageTotals;
    providers: readonly UsageProviderRow[];
    days: readonly UsageDayRow[];
    projects: readonly UsageProjectRow[];
  },
  granularity: BucketGranularity,
  window: DayWindow | null,
): BreakdownViewRow[] {
  switch (tab) {
    case 'provider':
    case 'model':
      return providerModelRows(payload.providers, payload.totals.cost);
    case 'day':
      return dayRows(payload.days, granularity, payload.totals.cost, window);
    case 'project':
      return projectRows(payload.projects, payload.totals.cost);
  }
}
