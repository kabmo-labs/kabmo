/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Deterministic demo payload for the Token Usage panel under MOCK mode.
 *
 * Built through the same `TokenUsagePayload` shape the real route answers with,
 * so a demo-only field can never exist and a real-only field can never be
 * missing from the demo — that divergence is how a panel renders correctly in
 * one mode and crashes in the other.
 *
 * The numbers are a plausible month for two providers sharing one model id,
 * which is exactly the case the breakdown exists to separate.
 */

import { dayRangeLabel, dayWindow, localDayKey, timeRangeOptions } from '@/shared/lib/usage/range';
import type {
  TimeRangeType,
  TokenUsagePayload,
  UsageDayRow,
  UsageProviderRow,
  UsageProjectRow,
} from '@/shared/types';

const DAY_MS = 24 * 60 * 60 * 1000;

/** A record's worth of counters, so every row sums the same way. */
function counters(cost: number, tokens: number, records: number) {
  const cacheRead = Math.round(tokens * 0.965);
  const input = Math.round(tokens * 0.028);
  const output = tokens - cacheRead - input;
  return {
    cost, tokens, input, output, cacheRead, cacheWrite: 0,
    reasoning: Math.round(output * 0.21), cacheReadCost: cost * 0.12,
    records, unpriced: 0,
  };
}

const PROVIDER_BASE: Array<{ id: string; name: string; models: Array<[string, number, number, number]> }> = [
  {
    id: 'kenari-jatis',
    name: 'Kenari Jatis',
    models: [['deepseek-v4-1-flash', 38.42, 210_400_000, 1_120]],
  },
  {
    id: 'kenari',
    name: 'Kenari.id',
    models: [
      ['deepseek-v4-1-flash', 5.18, 190_200_000, 980],
      ['minimax-m3', 2.71, 41_800_000, 214],
      ['glm-5-3-flash', 0.42, 22_100_000, 168],
    ],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    models: [
      ['deepseek-flash', 1.96, 64_300_000, 402],
      ['deepseek-v4-pro', 0.61, 8_400_000, 96],
    ],
  },
];

/** The provider → model tree for one period, scaled from the base numbers. */
function providersFor(scale: number): UsageProviderRow[] {
  return PROVIDER_BASE.map((provider) => {
    const models = provider.models.map(([model, cost, tokens, records]) => ({
      model,
      ...counters(cost * scale, Math.round(tokens * scale), Math.round(records * scale)),
    }));
    const summed = models.reduce(
      (acc, model) => {
        acc.cost += model.cost;
        acc.tokens += model.tokens;
        acc.input += model.input;
        acc.output += model.output;
        acc.cacheRead += model.cacheRead;
        acc.cacheWrite += model.cacheWrite;
        acc.reasoning += model.reasoning;
        acc.cacheReadCost += model.cacheReadCost;
        acc.records += model.records;
        acc.unpriced += model.unpriced;
        return acc;
      },
      { cost: 0, tokens: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, cacheReadCost: 0, records: 0, unpriced: 0 },
    );
    return { id: provider.id, name: provider.name, models, ...summed };
  }).sort((a, b) => b.cost - a.cost);
}

/** Days covered by a range, newest last, with a plausible weekend shape. */
function daysFor(range: TimeRangeType, now: number): UsageDayRow[] {
  const window = dayWindow(range, now);
  const dayCount = window
    ? Math.max(1, Math.round((Date.parse(`${window.to}T00:00:00`) - Date.parse(`${window.from}T00:00:00`)) / DAY_MS) + 1)
    : 30;
  const days: UsageDayRow[] = [];
  for (let offset = dayCount - 1; offset >= 0; offset--) {
    const at = now - offset * DAY_MS;
    const dayKey = localDayKey(at);
    if (window && (dayKey < window.from || dayKey > window.to)) continue;
    const weekday = new Date(at).getDay();
    const weekend = weekday === 0 || weekday === 6;
    const weight = weekend ? 0.35 : 1;
    const providers: Record<string, { cost: number; tokens: number }> = {
      'kenari-jatis': { cost: 1.24 * weight, tokens: Math.round(6_900_000 * weight) },
      kenari: { cost: 0.24 * weight, tokens: Math.round(6_600_000 * weight) },
      deepseek: { cost: 0.08 * weight, tokens: Math.round(2_200_000 * weight) },
    };
    const cost = Object.values(providers).reduce((sum, split) => sum + split.cost, 0);
    const tokens = Object.values(providers).reduce((sum, split) => sum + split.tokens, 0);
    days.push({ day: dayKey, providers, ...counters(cost, tokens, Math.round(weight * 78)) });
  }
  return days;
}

const PROJECTS = ['kabmo', 'omp', 'notes', 'scratch'];

function projectsFor(scale: number): UsageProjectRow[] {
  const shares = [0.62, 0.24, 0.1, 0.04];
  return PROJECTS.map((project, index) => ({
    project,
    ...counters(
      Number((48.3 * scale * shares[index]).toFixed(2)),
      Math.round(528_000_000 * scale * shares[index]),
      Math.round(2_980 * scale * shares[index]),
    ),
  }));
}

/** Demo payload for the requested range. */
export function mockTokenUsagePayload(range: TimeRangeType, now: number = Date.now()): TokenUsagePayload {
  const window = dayWindow(range, now);
  const scale = range === 'today' ? 0.04 : range === '7d' ? 0.24 : range === '90d' ? 2.6 : range === 'all' ? 3.4 : 1;
  const providers = providersFor(scale);
  const days = daysFor(range, now);
  const projects = projectsFor(scale);

  const totals = providers.reduce(
    (acc, provider) => {
      acc.cost += provider.cost;
      acc.tokens += provider.tokens;
      acc.input += provider.input;
      acc.output += provider.output;
      acc.cacheRead += provider.cacheRead;
      acc.cacheWrite += provider.cacheWrite;
      acc.reasoning += provider.reasoning;
      acc.cacheReadCost += provider.cacheReadCost;
      acc.records += provider.records;
      acc.unpriced += provider.unpriced;
      return acc;
    },
    {
      cost: 0, tokens: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
      reasoning: 0, cacheReadCost: 0, records: 0, unpriced: 0,
      activeDays: days.length,
    },
  );

  return {
    generatedAt: now,
    index: {
      state: 'ready',
      transcripts: 1_225,
      records: 143_969,
      indexedAt: now,
      scanMs: 4_120,
    },
    timeRanges: timeRangeOptions(now),
    range,
    periodLabel: window ? dayRangeLabel(window.from, window.to, now) : 'All time',
    totals,
    providers,
    days,
    projects,
  };
}
