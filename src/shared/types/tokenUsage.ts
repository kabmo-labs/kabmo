/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Token Usage surface's wire contract (`GET /api/telemetry/tokens`).
 *
 * One payload carries every view the panel can draw for the requested period:
 * totals, the provider → model tree, the per-day rows the chart and the time
 * breakdown are both derived from, and the project rows. The breakdown tabs
 * therefore cost no request — they re-bucket data the client already holds.
 *
 * Every number here is RAW. Formatting (`$1.23`, `2.2M`) is the client's job,
 * because a formatted string cannot be re-aggregated and cannot be compared
 * against a threshold.
 */

/**
 * The PERIOD the panel reports — the one thing the header's switch selects.
 *
 * `today`/`7d`/`30d`/`90d` are trailing calendar spans ending today, labelled
 * Day/Week/Month/90 days; `all` is unbounded. None of them is a grouping
 * cadence: a period is a period, and every figure on the panel is the total for
 * exactly that period.
 */
export type TimeRangeType = 'today' | '7d' | '30d' | '90d' | 'all' | 'custom';

/**
 * How the selected period is chopped up for the chart and the time tab only.
 *
 * Derived from the period's own length (`granularityFor`), never chosen by the
 * user: a month draws days, a quarter draws weeks, all time draws months.
 */
export type BucketGranularity = 'day' | 'week' | 'month';
/** Breakdown tabs. `provider` and `model` render as one two-level tree. */
export type BreakdownTab = 'provider' | 'model' | 'day' | 'project';
export type ChartMetric = 'cost' | 'tokens';

export interface TimeRangeOption {
  id: TimeRangeType;
  label: string;
  /** The dates this range covers, already formatted for the header. */
  dateRange: string;
}

/** Token and cost counters shared by every rollup row. */
export interface UsageCounters {
  cost: number;
  tokens: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  /** Cache-read rate: the observed input that was served from cache. */
  cacheReadCost: number;
  /** Usage records folded into this row. */
  records: number;
  /** Records carrying tokens but no provider-reported cost. */
  unpriced: number;
}

/** Totals for the selected period. */
export interface UsageTotals extends UsageCounters {
  /** Distinct days with at least one record. */
  activeDays: number;
}

/** One point of the flat chart series (single line, e.g. the mobile view). */
export interface ChartSeriesPoint {
  label: string;
  cost: number;
  tokens: number;
}

/** Display strings behind the headline tiles, already formatted. */
export interface TokenUsageMetricSet {
  rawCost: string;
  costPerMillion: string;
  processedTokens: string;
  activeRate: string;
  cachedInput: string;
  cachedPercent: string;
  uncachedInput: string;
  cacheWrite: string;
  outputTokens: string;
  reasoning: string;
  records: number;
  unpricedRecords: number;
}

/** One model under a provider. `model` is omp's own id, verbatim. */
export interface UsageModelRow extends UsageCounters {
  model: string;
}

/** One provider, with its models ordered by cost. */
export interface UsageProviderRow extends UsageCounters {
  /** Canonical provider slug — stable identity, used as the selection key. */
  id: string;
  /** Display name (`Kenari.id`, `DeepSeek`, `Command Code`, …). */
  name: string;
  models: UsageModelRow[];
}

/** One calendar day, with the per-provider split the stacked chart needs. */
export interface UsageDayRow extends UsageCounters {
  /** `YYYY-MM-DD` in the reader's local calendar. */
  day: string;
  /** Cost/tokens keyed by canonical provider slug. */
  providers: Record<string, { cost: number; tokens: number }>;
}

/** One project (the sessions-tree folder the transcript lives in). */
export interface UsageProjectRow extends UsageCounters {
  project: string;
}

/** How far the on-disk index has got, shown in the panel's footer. */
export interface UsageIndexState {
  /** `building` while a scan is in flight; the panel polls and keeps the data. */
  state: 'ready' | 'building' | 'failed';
  /** Transcripts indexed (or visited so far, while building). */
  transcripts: number;
  /** Usage records indexed across every period. */
  records: number;
  /** Epoch ms of the last completed scan. */
  indexedAt: number;
  /** Wall-clock cost of that scan, so a slow disk is visible rather than guessed. */
  scanMs: number;
  /** Sentence for the panel when `state` is `failed`. */
  error?: string;
}

/** Response body of `GET /api/telemetry/tokens`. */
export interface TokenUsagePayload {
  generatedAt: number;
  index: UsageIndexState;
  timeRanges: TimeRangeOption[];
  range: TimeRangeType;
  /** Human period label, e.g. `Oct 5 – Nov 3, 2026`. */
  periodLabel: string;
  totals: UsageTotals;
  /** Providers ordered by cost, each with its models ordered by cost. */
  providers: UsageProviderRow[];
  /** Daily rows ordered by day, ascending. */
  days: UsageDayRow[];
  /** Projects ordered by cost. */
  projects: UsageProjectRow[];
}
