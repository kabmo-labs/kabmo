/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Reads the Token Usage index and answers with one payload.
 *
 * All arithmetic lives in SQL over `usage_rollup`, which is why a period change
 * is a few milliseconds instead of a transcript scan: the expensive part
 * (parsing 1 580 MB of session files) happened once, in the indexer, and every
 * request only sums rows.
 *
 * `day = ''` means "the entry carried no usable timestamp". Those rows are
 * included in EVERY window — a missing date is not evidence of age — which is
 * why every predicate is `day = '' OR day BETWEEN …` rather than a bare range.
 */

import { getDb } from '@/server/db.server';
import { ensureUsageIndex } from '@/server/lib/usage/index-scan.server';
import { dayRangeLabel, dayWindow, timeRangeOptions } from '@/shared/lib/usage/range';
import type { TimeRangeType } from '@/shared/types';
import type {
  TokenUsagePayload,
  UsageCounters,
  UsageDayRow,
  UsageModelRow,
  UsageProjectRow,
  UsageProviderRow,
  UsageTotals,
} from '@/shared/types';
import { providerDisplayName } from '@/shared/lib/models/provider/label';

/** Columns every rollup aggregation sums, under the names SQL returns. */
const SUM_COLUMNS = `
  SUM(records) AS records,
  SUM(unpriced) AS unpriced,
  SUM(input) AS inputTokens,
  SUM(output) AS outputTokens,
  SUM(cache_read) AS cacheRead,
  SUM(cache_write) AS cacheWrite,
  SUM(reasoning) AS reasoning,
  SUM(total) AS tokens,
  SUM(cost_total) AS cost,
  SUM(cost_cache_read) AS cacheReadCost`;

interface SumRow {
  records: number | null;
  unpriced: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
  reasoning: number | null;
  tokens: number | null;
  cost: number | null;
  cacheReadCost: number | null;
}

interface ModelGroupRow extends SumRow {
  provider: string;
  model: string;
}

interface DayGroupRow extends SumRow {
  day: string;
  provider: string;
}

interface ProjectGroupRow extends SumRow {
  project: string;
}

function counters(row: SumRow): Counters {
  return {
    cost: row.cost ?? 0,
    tokens: row.tokens ?? 0,
    input: row.inputTokens ?? 0,
    output: row.outputTokens ?? 0,
    cacheRead: row.cacheRead ?? 0,
    cacheWrite: row.cacheWrite ?? 0,
    reasoning: row.reasoning ?? 0,
    cacheReadCost: row.cacheReadCost ?? 0,
    records: row.records ?? 0,
    unpriced: row.unpriced ?? 0,
  };
}

/**
 * The day predicate for a window: undated rows always count, dated rows only
 * inside the range. `null` (all time) matches everything.
 */
function windowClause(window: { from: string; to: string } | null): { sql: string; params: string[] } {
  if (!window) return { sql: '', params: [] };
  return { sql: `WHERE (day = '' OR day BETWEEN ? AND ?)`, params: [window.from, window.to] };
}

/**
 * Build the payload for a period.
 *
 * `wait` is for the first request of a process (nothing on screen yet); every
 * later one answers from whatever the index holds and lets the client poll.
 */
export async function buildTokenUsagePayload(options: {
  range?: TimeRangeType;
  customFrom?: string | null;
  customTo?: string | null;
  wait?: boolean;
  force?: boolean;
  now?: number;
} = {}): Promise<TokenUsagePayload> {
  const now = options.now ?? Date.now();
  const range = options.range ?? '30d';
  const window = dayWindow(range, now, { from: options.customFrom, to: options.customTo });

  const index = await ensureUsageIndex({ wait: options.wait, force: options.force });
  const db = await getDb();
  const where = windowClause(window);

  const [totalsRow, modelRows, dayRows, projectRows, activeDayRows] = await Promise.all([
    db.get<SumRow & { activeDays: number }>(
      `SELECT ${SUM_COLUMNS}, COUNT(DISTINCT NULLIF(day, '')) AS activeDays FROM usage_rollup ${where.sql}`,
      where.params,
    ),
    db.all<ModelGroupRow>(
      `SELECT provider, model, ${SUM_COLUMNS} FROM usage_rollup ${where.sql} GROUP BY provider, model ORDER BY cost DESC`,
      where.params,
    ),
    db.all<DayGroupRow>(
      `SELECT day, provider, ${SUM_COLUMNS} FROM usage_rollup ${where.sql} GROUP BY day, provider ORDER BY day`,
      where.params,
    ),
    db.all<ProjectGroupRow>(
      `SELECT project, ${SUM_COLUMNS} FROM usage_rollup ${where.sql} GROUP BY project ORDER BY cost DESC`,
      where.params,
    ),
    db.all<{ day: string }>(
      `SELECT DISTINCT day FROM usage_rollup ${where.sql ? `${where.sql} AND` : 'WHERE'} day <> ''`,
      where.params,
    ),
  ]);

  const totals: UsageTotals = {
    ...counters(totalsRow ?? emptySum()),
    activeDays: new Set(activeDayRows.map((row) => row.day).filter(Boolean)).size,
  };

  return {
    generatedAt: now,
    index,
    timeRanges: timeRangeOptions(now),
    range,
    periodLabel: window ? dayRangeLabel(window.from, window.to, now) : 'All time',
    totals,
    providers: groupProviders(modelRows),
    days: groupDays(dayRows),
    projects: groupProjects(projectRows),
  };
}

function emptySum(): SumRow {
  return {
    records: 0, unpriced: 0, inputTokens: 0, outputTokens: 0, cacheRead: 0,
    cacheWrite: 0, reasoning: 0, tokens: 0, cost: 0, cacheReadCost: 0,
  };
}

/**
 * Fold the (provider, model) groups into the two-level tree the panel draws.
 *
 * Ordering is by cost at both levels: the first row is the answer to "what is
 * costing me", and a collapsed provider's subtotal must be comparable with the
 * row above it.
 */
function groupProviders(rows: ModelGroupRow[]): UsageProviderRow[] {
  const providers = new Map<string, UsageProviderRow>();
  for (const row of rows) {
    let provider = providers.get(row.provider);
    if (!provider) {
      provider = {
        id: row.provider,
        name: providerDisplayName(row.provider),
        models: [],
        cost: 0, tokens: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
        reasoning: 0, cacheReadCost: 0, records: 0, unpriced: 0,
      };
      providers.set(row.provider, provider);
    }
    const model: UsageModelRow = { model: row.model, ...counters(row) };
    provider.models.push(model);
    addCounters(provider, model);
  }
  for (const provider of providers.values()) provider.models.sort((a, b) => b.cost - a.cost);
  return [...providers.values()].sort((a, b) => b.cost - a.cost);
}

interface Counters {
  cost: number;
  tokens: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  cacheReadCost: number;
  records: number;
  unpriced: number;
}

function addCounters(target: UsageCounters, source: Counters): void {
  target.cost += source.cost;
  target.tokens += source.tokens;
  target.input += source.input;
  target.output += source.output;
  target.cacheRead += source.cacheRead;
  target.cacheWrite += source.cacheWrite;
  target.reasoning += source.reasoning;
  target.cacheReadCost += source.cacheReadCost;
  target.records += source.records;
  target.unpriced += source.unpriced;
}

function groupDays(rows: DayGroupRow[]): UsageDayRow[] {
  const days = new Map<string, UsageDayRow & Counters>();
  for (const row of rows) {
    let day = days.get(row.day);
    if (!day) {
      day = {
        day: row.day,
        providers: {},
        cost: 0, tokens: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
        reasoning: 0, cacheReadCost: 0, records: 0, unpriced: 0,
      };
      days.set(row.day, day);
    }
    const counts = counters(row);
    addCounters(day, counts);
    const split = day.providers[row.provider] ?? { cost: 0, tokens: 0 };
    split.cost += counts.cost;
    split.tokens += counts.tokens;
    day.providers[row.provider] = split;
  }
  return [...days.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

function groupProjects(rows: ProjectGroupRow[]): UsageProjectRow[] {
  return rows.map((row) => ({ project: row.project, ...counters(row) }));
}
