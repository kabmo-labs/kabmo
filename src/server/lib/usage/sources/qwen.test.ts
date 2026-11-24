/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Qwen token log reader.
 *
 * The log reports `inputTokens` INCLUDING the cached prompt and `cachedTokens`
 * separately; the index stores the uncached remainder or the panel counts those
 * tokens twice. The project comes from the session's chat file, not the log.
 */

import { describe, expect, test } from 'bun:test';

import { qwenRowsFromText } from '@/server/lib/usage/sources/qwen.server';

function line(value: Record<string, unknown>): string {
  return JSON.stringify(value);
}

describe('qwenRowsFromText', () => {
  test('subtracts cached input and maps the session to its project', () => {
    const rows = qwenRowsFromText([
      line({
        schemaVersion: 1,
        timestamp: '2026-11-06T20:53:12.240Z',
        localDate: '2026-11-07',
        sessionId: 's1',
        model: 'qwen3-coder',
        inputTokens: 100,
        cachedTokens: 40,
        outputTokens: 10,
        thoughtsTokens: 5,
        totalTokens: 115,
      }),
      line({
        schemaVersion: 1,
        timestamp: '2026-11-07T01:00:00.000Z',
        sessionId: 's2',
        model: 'qwen3-coder',
        inputTokens: 0,
        cachedTokens: 0,
        outputTokens: 0,
        thoughtsTokens: 0,
        totalTokens: 0,
      }),
    ].join('\n'), new Map([['s1', 'kabmo']]));

    expect(rows).toHaveLength(1);
    const row = [...rows.values()][0];
    expect(row.harness).toBe('qwen');
    expect(row.project).toBe('kabmo');
    expect(row.day).toBe('2026-11-07');
    expect(row.input).toBe(60);
    expect(row.cacheRead).toBe(40);
    expect(row.output).toBe(10);
    expect(row.reasoning).toBe(5);
    expect(row.total).toBe(115);
    expect(row.unpriced).toBe(1);
  });
});
