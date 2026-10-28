/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Presentation shaping over the aggregate built by `./usage`: chart series,
 * metric set, and breakdown rows. Split from the aggregator so the disk-scanning
 * module stays focused (and under the repo's per-file size ceiling).
 */

import type { BreakdownRow, CadenceType, ChartSeriesPoint, TokenUsageMetricSet } from '@/shared/types';
import type { UsageAggregate } from '@/server/lib/omp/session/usage/aggregate';

const fmtInt = (value: number): string => value.toLocaleString('en-US');
const fmtUsd = (value: number): string => `$${value.toFixed(2)}`;

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

function dayLabel(dayKey: string): string {
  const date = new Date(`${dayKey}T00:00:00`);
  return Number.isNaN(date.getTime()) ? dayKey : `${MONTH_LABELS[date.getMonth()]} ${date.getDate()}`;
}

function bucketKey(dayKey: string, cadence: CadenceType): string {
  if (cadence === 'monthly') return dayKey.slice(0, 7);
  if (cadence === 'weekly') {
    const date = new Date(`${dayKey}T00:00:00`);
    if (Number.isNaN(date.getTime())) return dayKey;
    const monday = new Date(date);
    const shift = (date.getDay() + 6) % 7;
    monday.setDate(date.getDate() - shift);
    return monday.toISOString().slice(0, 10);
  }
  return dayKey;
}

function labelForBucket(key: string, cadence: CadenceType): string {
  if (cadence === 'monthly') {
    const [year, month] = key.split('-');
    const monthIndex = Number(month) - 1;
    const label = MONTH_LABELS[monthIndex] ?? key;
    return year && Number(year) !== new Date().getFullYear() ? `${label} ${year}` : label;
  }
  return dayLabel(key);
}

/** Shape the per-day aggregate into an ordered chart series for the cadence:
 * weekly buckets align to Monday, monthly to YYYY-MM, and the series is
 * truncated to the last 60 buckets so the SVG path stays readable. */
export function buildChartSeries(a: UsageAggregate, cadence: CadenceType): ChartSeriesPoint[] {
  const buckets = new Map<string, { cost: number; tokens: number }>();
  for (const [dayKey, v] of a.byDay) {
    const key = bucketKey(dayKey, cadence);
    const current = buckets.get(key) ?? { cost: 0, tokens: 0 };
    current.cost += v.cost;
    current.tokens += v.tokens;
    buckets.set(key, current);
  }
  return [...buckets.entries()]
    .sort(([aKey], [bKey]) => (aKey < bKey ? -1 : aKey > bKey ? 1 : 0))
    .slice(-60)
    .map(([key, v]) => ({ label: labelForBucket(key, cadence), cost: v.cost, tokens: v.tokens }));
}

export function toMetricSet(a: UsageAggregate, cadence: CadenceType = 'daily'): TokenUsageMetricSet {
  const observedInput = a.inputTokens + a.cacheReadTokens;
  const cachedPercent = observedInput > 0 ? ((a.cacheReadTokens / observedInput) * 100).toFixed(1) : '0.0';
  const unit = cadence === 'weekly' ? 'week' : cadence === 'monthly' ? 'month' : 'day';
  return {
    rawCost: fmtUsd(a.costTotal),
    processedTokens: fmtInt(a.inputTokens + a.outputTokens + a.cacheReadTokens + a.cacheWriteTokens),
    activeRate: `${a.activeDays.size} active ${unit}${a.activeDays.size === 1 ? '' : 's'}`,
    cachedInput: fmtInt(a.cacheReadTokens),
    cachedPercent: `${cachedPercent}% of observed input`,
    uncachedInput: fmtInt(a.inputTokens),
    outputTokens: fmtInt(a.outputTokens),
    reasoning: `includes ${fmtInt(a.reasoningTokens)} reasoning`,
    cacheSavings: fmtUsd(a.costCacheRead),
    scannedTranscripts: a.scannedTranscripts,
    usageRecords: a.usageRecords,
  };
}

const BREAKDOWN_DOT_COLORS = [
  'bg-[var(--theme-ink)]',
  'bg-[var(--theme-ink)]/70',
  'bg-[var(--theme-ink)]/50',
  'bg-[var(--theme-ink)]/35',
  'bg-[var(--theme-ink)]/20',
] as const;

/** Build breakdown rows (model/day/project) from the aggregate; the `day` tab
 * is bucketed by the cadence (day/week/month) so it stays consistent with the chart. */
export function toBreakdownRows(
  a: UsageAggregate,
  tab: 'model' | 'day' | 'project',
  cadence: CadenceType = 'daily',
): BreakdownRow[] {
  if (tab === 'day' && cadence !== 'daily') {
    const buckets = new Map<string, { tokens: number; cost: number }>();
    for (const [dayKey, v] of a.byDay) {
      const key = bucketKey(dayKey, cadence);
      const current = buckets.get(key) ?? { tokens: 0, cost: 0 };
      current.tokens += v.tokens;
      current.cost += v.cost;
      buckets.set(key, current);
    }
    const merged: UsageAggregate = { ...a, byDay: buckets };
    return toBreakdownRows(merged, 'day', 'daily');
  }
  const source = tab === 'model' ? a.byModel : tab === 'day' ? a.byDay : a.byProject;
  return [...source.entries()]
    .map(([name, v]) => ({
      name: tab === 'day' ? labelForBucket(name, cadence) : name,
      tokens: v.tokens,
      cost: v.cost,
      sharePercent: a.costTotal > 0 ? Math.round((v.cost / a.costTotal) * 100) : 0,
    }))
    .sort((x, y) => y.cost - x.cost)
    .slice(0, 12)
    .map((row, index) => ({
      name: row.name,
      tokens: fmtInt(row.tokens),
      cost: fmtUsd(row.cost),
      share: `${row.sharePercent}%`,
      sharePercent: row.sharePercent,
      dotColorClass: BREAKDOWN_DOT_COLORS[index % BREAKDOWN_DOT_COLORS.length],
    }));
}
