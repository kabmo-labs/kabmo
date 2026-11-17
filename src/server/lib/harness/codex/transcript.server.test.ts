/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Codex rollout reader.
 *
 * It exists because a session open in the terminal refuses `session/resume`:
 * the rollout is the only readable copy. The mapping must drop Codex's own
 * scaffolding (`developer` turns and `<environment_context>`) while keeping the
 * operator's words, the answer, and a tool call's result.
 */

import { describe, expect, test } from 'bun:test';
import { codexMessagesFromRollout } from '@/server/lib/harness/codex/transcript.server';

const line = (type: string, payload: Record<string, unknown>, timestamp = '2026-11-17T01:17:22.537Z') =>
  JSON.stringify({ type, timestamp, payload });

const BODY = [
  line('session_meta', { session_id: 's1', cwd: '/work' }),
  line('response_item', { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'You are Codex' }] }),
  line('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>\n  <cwd>/work</cwd>\n</environment_context>' }] }),
  line('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'halo' }] }),
  line('response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Halo! Ada yang bisa saya bantu?' }] }),
  line('response_item', { type: 'function_call', name: 'shell', arguments: '{"command":"ls -la"}', call_id: 'c1' }),
  line('response_item', { type: 'function_call_output', call_id: 'c1', output: 'total 0' }),
].join('\n');

describe('codexMessagesFromRollout', () => {
  test('keeps the conversation and drops the scaffolding', () => {
    const rows = codexMessagesFromRollout(BODY);
    expect(rows.map((row) => [row.role, row.content])).toEqual([
      ['user', 'halo'],
      ['ai', 'Halo! Ada yang bisa saya bantu?'],
    ]);
  });

  test('a tool call pairs with its output and is attached to the answer', () => {
    const rows = codexMessagesFromRollout(BODY);
    const call = rows[1].toolCalls?.[0];
    expect(call).toMatchObject({
      id: 'c1',
      type: 'bash',
      command: 'ls -la',
      output: 'total 0',
      status: 'success',
    });
  });

  test('an unanswered call is settled as aborted, never left running', () => {
    const rows = codexMessagesFromRollout([
      line('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'do it' }] }),
      line('response_item', { type: 'function_call', name: 'shell', arguments: '{"command":"sleep 9"}', call_id: 'c2' }),
    ].join('\n'));
    expect(rows[1].toolCalls?.[0]).toMatchObject({ id: 'c2', status: 'aborted' });
  });

  test('a malformed line is skipped rather than losing the whole transcript', () => {
    const rows = codexMessagesFromRollout([
      '{not json',
      line('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'still here' }] }),
    ].join('\n'));
    expect(rows.map((row) => row.content)).toEqual(['still here']);
  });
});
