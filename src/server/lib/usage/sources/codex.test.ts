/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Codex rollout reader.
 *
 * `last_token_usage` is a delta and must be summed as one; `total_token_usage`
 * is cumulative and a total-only rollout must be diffed. Both are pinned here,
 * along with the cached-input subtraction the panel's hit rate depends on.
 */

import { describe, expect, test } from 'bun:test';

import { codexRowsFromText } from '@/server/lib/usage/sources/codex.server';

function line(value: Record<string, unknown>): string {
  return JSON.stringify(value);
}

describe('codexRowsFromText', () => {
  test('sums one delta per token_count and attributes model/provider/cwd', () => {
    const { rows, project } = codexRowsFromText([
      line({ type: 'session_meta', payload: { cwd: '/Users/dev/projects/kabmo', model_provider: 'openai' } }),
      line({ type: 'turn_context', payload: { model: 'gpt-6.1-sol' } }),
      line({ timestamp: '2026-11-17T00:22:54.380Z', type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 7, reasoning_output_tokens: 2, total_tokens: 107 } } } }),
      line({ timestamp: '2026-11-17T00:25:00.000Z', type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 50, cached_input_tokens: 10, output_tokens: 3, reasoning_output_tokens: 0, total_tokens: 53 } } } }),
    ].join('\n'), 'codex');

    expect(project).toBe('kabmo');
    const row = [...rows.values()][0];
    expect(row.harness).toBe('codex');
    expect(row.provider).toBe('openai');
    expect(row.model).toBe('gpt-6.1-sol');
    expect(row.records).toBe(2);
    // Cached input is reported inside input_tokens; the panel's input is the
    // uncached remainder or cache reads are counted twice.
    expect(row.input).toBe(60 + 40);
    expect(row.cacheRead).toBe(50);
    expect(row.output).toBe(10);
    expect(row.total).toBe(160);
  });

  test('a total-only rollout is folded as a difference, never per event', () => {
    const { rows } = codexRowsFromText([
      line({ timestamp: '2026-11-17T00:22:54.380Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 10, total_tokens: 110 } } } }),
      line({ timestamp: '2026-11-17T00:25:00.000Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 150, cached_input_tokens: 0, output_tokens: 20, total_tokens: 170 } } } }),
    ].join('\n'), 'codex');

    expect([...rows.values()][0].total).toBe(170);
  });
});
