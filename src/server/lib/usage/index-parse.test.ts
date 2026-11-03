/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Folding one transcript line into rollup counters — the pure half of the
 * Token Usage index.
 *
 * Every case pins a number a user reads, so the assertions are exact:
 *
 *  - a provider is part of a row's identity (two accounts serving one model id
 *    are two rows, not one merged cost);
 *  - the day is the reader's LOCAL calendar day, so "Today" and the chart agree;
 *  - a turn with tokens and no reported cost is unpriced, never free;
 *  - a torn final line must be dropped, or the next append would parse its
 *    remainder as a fresh entry.
 */

import { describe, expect, test } from 'bun:test';

import {
  completeLineOffset,
  foldUsage,
  foldUsageText,
  parseUsageLine,
  type ParsedUsageEntry,
  type UsageRollupRow,
} from '@/server/lib/usage/index-parse';
import { localDayKey } from '@/shared/lib/usage/range';


function messageLine(options: {
  timestamp?: string;
  provider?: string;
  model?: string;
  usage?: Record<string, unknown>;
}): string {
  return JSON.stringify({
    type: 'message',
    timestamp: options.timestamp,
    message: {
      role: 'assistant',
      provider: options.provider,
      model: options.model,
      usage: options.usage ?? {},
    },
  });
}

function costed(options: {
  timestamp: string;
  provider: string;
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cost: number;
}): string {
  return messageLine({
    timestamp: options.timestamp,
    provider: options.provider,
    model: options.model,
    usage: {
      input: options.input,
      output: options.output,
      cacheRead: options.cacheRead,
      cacheWrite: 0,
      totalTokens: options.input + options.output + options.cacheRead,
      cost: { total: options.cost, input: options.cost / 2, output: options.cost / 4, cacheRead: options.cost / 4, cacheWrite: 0 },
    },
  });
}

describe('parseUsageLine', () => {
  test('attributes the provider and model that served the turn', () => {
    const parsed = parseUsageLine(costed({
      timestamp: '2026-10-05T10:00:00.000Z',
      provider: 'kenari-jatis',
      model: 'deepseek-v4-1-flash',
      input: 10,
      output: 5,
      cacheRead: 100,
      cost: 1.5,
    }));
    expect(parsed).not.toBeNull();
    expect(parsed?.provider).toBe('kenari-jatis');
    expect(parsed?.model).toBe('deepseek-v4-1-flash');
  });

  test('folds a slug alias onto one provider identity', () => {
    // omp writes both spellings; the breakdown must not grow a second
    // `command-code` row beside `commandcode`.
    const parsed = parseUsageLine(costed({
      timestamp: '2026-10-05T10:00:00.000Z',
      provider: 'command-code',
      model: 'glm-5.3-flash',
      input: 1,
      output: 1,
      cacheRead: 0,
      cost: 0,
    }));
    expect(parsed?.provider).toBe('commandcode');
  });

  test('missing provider and model become `unknown`, not empty strings', () => {
    const parsed = parseUsageLine(messageLine({ timestamp: '2026-10-05T10:00:00.000Z' }));
    expect(parsed?.provider).toBe('unknown');
    expect(parsed?.model).toBe('unknown');
  });

  test('the day is the local calendar day of the timestamp', () => {
    const at = new Date(2026, 9, 5, 0, 30, 0).getTime();
    const parsed = parseUsageLine(costed({
      timestamp: new Date(at).toISOString(),
      provider: 'kenari',
      model: 'm',
      input: 1,
      output: 0,
      cacheRead: 0,
      cost: 0,
    }));
    // UTC is still Oct 4 for a 00:30 WIB record; the panel's "Today" is local.
    expect(parsed?.day).toBe(localDayKey(at));
    expect(parsed?.day).toBe('2026-10-05');
  });

  test('a line with no timestamp keeps an empty day so windows can include it', () => {
    const parsed = parseUsageLine(messageLine({ provider: 'kenari', model: 'm' }));
    expect(parsed?.day).toBe('');
  });

  test('non-message entries and torn lines are rejected', () => {
    expect(parseUsageLine(JSON.stringify({ type: 'custom', message: { usage: { input: 1 } } }))).toBeNull();
    expect(parseUsageLine(messageLine({}).slice(0, 20))).toBeNull();
    expect(parseUsageLine('')).toBeNull();
  });
});

describe('foldUsage', () => {
  const rows = new Map<string, UsageRollupRow>();
  const entry = (provider: string, model: string, cost: number, totalTokens = 10): ParsedUsageEntry => ({
    day: '2026-10-05',
    provider,
    model,
    usage: { input: 4, output: 2, cacheRead: 4, cacheWrite: 0, totalTokens, cost: { total: cost } },
  });

  test('keys on provider AND model, so two accounts stay separate', () => {
    foldUsage(rows, 'p', entry('kenari-jatis', 'deepseek-v4-1-flash', 10));
    foldUsage(rows, 'p', entry('kenari', 'deepseek-v4-1-flash', 2));
    expect(rows.size).toBe(2);
    expect([...rows.values()].map((row) => row.provider).sort()).toEqual(['kenari', 'kenari-jatis']);
  });

  test('one key accumulates its counters rather than replacing them', () => {
    const single = new Map<string, UsageRollupRow>();
    foldUsage(single, 'p', entry('kenari', 'm', 1.5));
    foldUsage(single, 'p', entry('kenari', 'm', 2.5));
    const row = [...single.values()][0];
    expect(row.records).toBe(2);
    expect(row.costTotal).toBeCloseTo(4, 10);
    expect(row.total).toBe(20);
  });

  test('an explicit totalTokens wins over the re-derived sum', () => {
    const single = new Map<string, UsageRollupRow>();
    foldUsage(single, 'p', entry('kenari', 'm', 1, 999));
    expect([...single.values()][0].total).toBe(999);
  });

  test('a turn with tokens and no reported cost counts as unpriced', () => {
    const single = new Map<string, UsageRollupRow>();
    foldUsage(single, 'p', entry('kenari', 'm', 0));
    expect([...single.values()][0].unpriced).toBe(1);
  });
});

describe('foldUsageText', () => {
  test('a partial last line is dropped when only complete lines are wanted', () => {
    const complete = costed({ timestamp: '2026-10-05T10:00:00.000Z', provider: 'kenari', model: 'm', input: 1, output: 1, cacheRead: 0, cost: 1 });
    const text = `${complete}\n{"type":"message","message":{"usage":{"inp`;
    const rows = new Map<string, UsageRollupRow>();
    foldUsageText(rows, 'p', text, true);
    expect([...rows.values()][0].records).toBe(1);

    // The same text read as a whole file keeps the trailing fragment's parse
    // failure silent rather than throwing.
    const whole = new Map<string, UsageRollupRow>();
    foldUsageText(whole, 'p', text, false);
    expect([...whole.values()][0].records).toBe(1);
  });

  test('completeLineOffset stops at the last newline, never mid-line', () => {
    expect(completeLineOffset('{"a":1}\n{"b":2}\n')).toBe(16);
    expect(completeLineOffset('{"a":1}\n{"b":')).toBe(8);
    expect(completeLineOffset('no newline')).toBe(0);
  });
});

