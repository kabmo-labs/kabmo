/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Claude transcript reader.
 *
 * Two record kinds answer different questions: per-turn tokens and one
 * session-level cost. The cases here pin that the cost is not counted as a
 * turn, that a duplicate message id is folded once, and that the LAST
 * `cost-state` wins (it is cumulative, not a per-turn row).
 */

import { describe, expect, test } from 'bun:test';

import { claudeRowsFromText } from '@/server/lib/usage/sources/claude.server';

function line(value: Record<string, unknown>): string {
  return JSON.stringify(value);
}

const assistant = (options: {
  id: string;
  timestamp: string;
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}): string => line({
  type: 'assistant',
  uuid: `uuid-${options.id}`,
  timestamp: options.timestamp,
  cwd: '/Users/dev/projects/kabmo',
  message: {
    id: options.id,
    model: options.model,
    usage: {
      input_tokens: options.input,
      output_tokens: options.output,
      cache_read_input_tokens: options.cacheRead,
      cache_creation_input_tokens: options.cacheWrite,
      output_tokens_details: { thinking_tokens: 4 },
    },
  },
});

describe('claudeRowsFromText', () => {
  test('folds per-turn tokens and keeps the cwd as the project', () => {
    const { rows, project } = claudeRowsFromText([
      assistant({ id: 'a', timestamp: '2026-11-18T12:00:00.000Z', model: 'deepseek-v4', input: 10, output: 5, cacheRead: 100, cacheWrite: 3 }),
      assistant({ id: 'a', timestamp: '2026-11-18T12:00:00.000Z', model: 'deepseek-v4', input: 10, output: 5, cacheRead: 100, cacheWrite: 3 }),
    ].join('\n'), '-Users-dev-projects-kabmo');

    expect(project).toBe('kabmo');
    const row = [...rows.values()][0];
    expect(row.harness).toBe('claude');
    expect(row.provider).toBe('claude');
    expect(row.model).toBe('deepseek-v4');
    expect(row.records).toBe(1);
    expect(row.input).toBe(10);
    expect(row.output).toBe(5);
    expect(row.cacheRead).toBe(100);
    expect(row.cacheWrite).toBe(3);
    expect(row.reasoning).toBe(4);
    expect(row.total).toBe(118);
    expect(row.unpriced).toBe(1);
  });

  test('adds the session cost once and only from the last cost-state', () => {
    const { rows } = claudeRowsFromText([
      assistant({ id: 'a', timestamp: '2026-11-18T12:00:00.000Z', model: 'sonnet', input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }),
      line({ type: 'cost-state', startTime: Date.parse('2026-11-19T11:00:00.000Z'), totalCostUSD: 0.5, modelUsage: { haiku: { costUSD: 0.5 } } }),
      line({ type: 'cost-state', startTime: Date.parse('2026-11-19T11:00:00.000Z'), totalCostUSD: 0.75, modelUsage: { haiku: { costUSD: 0.75 } } }),
    ].join('\n'), 'proj');

    const costRows = [...rows.values()].filter((row) => row.costTotal > 0);
    expect(costRows).toHaveLength(1);
    expect(costRows[0].costTotal).toBe(0.75);
    // A cost-state is a session total, not a turn.
    expect(costRows[0].records).toBe(0);
    // It lands on the last day the session spent on, not on its start date.
    expect(costRows[0].day).toBe('2026-11-18');
  });
});
