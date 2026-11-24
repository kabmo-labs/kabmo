/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The dsh session reader.
 *
 * dsh writes one assistant record per turn with the provider/model on
 * `message.source` and the split on `data.usage`. The session header's cwd is
 * the project; no cost is recorded, so the turn is unpriced.
 */

import { describe, expect, test } from 'bun:test';

import { dshRowsFromText } from '@/server/lib/usage/sources/dsh.server';

function line(value: Record<string, unknown>): string {
  return JSON.stringify(value);
}

describe('dshRowsFromText', () => {
  test('folds an assistant message and takes the project from the session header', () => {
    const { rows, project } = dshRowsFromText([
      line({ type: 'session', version: 4, cwd: '/Users/dev/projects/kabmo' }),
      line({ type: 'turn/start', seq: 5, time: 1794194574966, data: { turn: 1 } }),
      line({
        type: 'assistant/message',
        seq: 14,
        time: 1794194443170,
        data: {
          message: { source: { kind: 'model', provider: 'kenari', model: 'qwen3-8-27b:free' } },
          usage: { inputTokens: 5784, outputTokens: 72, totalTokens: 5856 },
        },
      }),
    ].join('\n'), 'encoded-project');

    expect(project).toBe('kabmo');
    const row = [...rows.values()][0];
    expect(row.harness).toBe('dsh');
    expect(row.provider).toBe('kenari');
    expect(row.model).toBe('qwen3-8-27b:free');
    expect(row.records).toBe(1);
    expect(row.input).toBe(5784);
    expect(row.output).toBe(72);
    expect(row.total).toBe(5856);
    expect(row.unpriced).toBe(1);
  });
});
