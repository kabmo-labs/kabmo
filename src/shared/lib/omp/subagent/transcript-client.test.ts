/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Covers the subagent transcript conversion's thinking-level stamping.
 *
 * A subagent transcript records its level as a separate `thinking_level_change`
 * entry, never as a per-message field, so `convertMessages` has to walk the
 * records and stamp the level in effect — otherwise the footer has no level to
 * show and drops the segment entirely. The child's own level is the only
 * correct one: a subagent routinely runs at a different level than the chat
 * that spawned it, so borrowing the parent's would mislabel every row.
 *
 * Also pins the non-message entry handling the walk sits beside: a change
 * record must be consumed, not converted into a row.
 */

import { describe, expect, test } from 'bun:test';

import { convertMessages, mergeMessages } from '@/shared/lib/omp/subagent/transcript-client';
import type { ChatMessageData } from '@/shared/types';

/** An assistant message entry carrying text, as omp writes it to the JSONL. */
function assistantEntry(id: string, text: string): Record<string, unknown> {
  return {
    type: 'message',
    id,
    timestamp: 1790403839189,
    message: {
      role: 'assistant',
      model: 'deepseek-v4-flash',
      provider: 'kenari',
      content: [{ type: 'text', text }],
    },
  };
}

function changeEntry(level: unknown): Record<string, unknown> {
  return { type: 'thinking_level_change', id: `chg-${String(level)}`, thinkingLevel: level, configured: null };
}

describe('convertMessages thinking-level stamping', () => {
  test('stamps the level in effect onto assistant rows', () => {
    const rows = convertMessages([changeEntry('low'), assistantEntry('a1', 'first'), assistantEntry('a2', 'second')], false);
    expect(rows.map((row) => row.thinkingLevel)).toEqual(['low', 'low']);
  });

  test('follows a mid-transcript change, so each turn keeps the level that served it', () => {
    const rows = convertMessages([
      changeEntry('low'),
      assistantEntry('a1', 'first'),
      changeEntry('high'),
      assistantEntry('a2', 'second'),
    ], false);
    expect(rows[0].thinkingLevel).toBe('low');
    expect(rows[1].thinkingLevel).toBe('high');
  });

  test('normalizes a null level record to "off" rather than dropping the segment', () => {
    const rows = convertMessages([changeEntry(null), assistantEntry('a1', 'first')], false);
    expect(rows[0].thinkingLevel).toBe('off');
  });

  test('leaves user rows unstamped and the level absent before any record', () => {
    const rows = convertMessages([
      { type: 'message', id: 'u1', message: { role: 'user', content: 'hi' } },
      assistantEntry('a1', 'answer'),
      changeEntry('max'),
      assistantEntry('a2', 'later'),
    ], false);
    expect(rows[0].role).toBe('user');
    expect(rows[0].thinkingLevel).toBeUndefined();
    expect(rows[1].thinkingLevel).toBeUndefined();
    expect(rows[2].thinkingLevel).toBe('max');
  });

  test('consumes the change record instead of turning it into a row', () => {
    const rows = convertMessages([changeEntry('low')], false);
    expect(rows).toHaveLength(0);
  });
});

describe('mergeMessages', () => {
  test('replaces a streamed row in place so its stamped level survives finalization', () => {
    const streamed = convertMessages([changeEntry('low'), assistantEntry('a1', 'partial')], true);
    const final = convertMessages([changeEntry('low'), assistantEntry('a1', 'complete answer')], false);
    const merged = mergeMessages(streamed, final);
    expect(merged).toHaveLength(1);
    expect(merged[0].content).toBe('complete answer');
    expect(merged[0].thinkingLevel).toBe('low');
  });

  test('appends a row whose id is new', () => {
    const prev: ChatMessageData[] = convertMessages([changeEntry('low'), assistantEntry('a1', 'first')], false);
    const merged = mergeMessages(prev, convertMessages([changeEntry('low'), assistantEntry('a2', 'second')], false));
    expect(merged.map((row) => row.id)).toEqual(['a1', 'a2']);
  });
});
