/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The reducer that turns replayed frames into Kabmo's transcript rows.
 *
 * It reads the LAST snapshot per message id: the mapper emits an accumulated
 * message on every update, and a `message_end` that follows carries the settled
 * one. A user turn and an assistant answer must both survive — the restore is
 * pointless if it keeps only half the conversation.
 */

import { describe, expect, test } from 'bun:test';
import { transcriptFromReplay } from '@/server/lib/harness/acp/replay-transcript';

const textMessage = (role: string, id: string, text: string, extra: Record<string, unknown> = {}) => ({
  role,
  id,
  timestamp: 1_700_000_000_000,
  content: [{ type: 'text', text }],
  ...extra,
});

describe('transcriptFromReplay', () => {
  test('keeps the settled snapshot of each message, in first-seen order', () => {
    const rows = transcriptFromReplay([
      { type: 'message_start', message: textMessage('user', 'u1', 'Reply with exactly: ok') },
      { type: 'message_start', message: textMessage('assistant', 'a1', 'o') },
      { type: 'message_update', message: textMessage('assistant', 'a1', 'ok') },
      { type: 'message_end', message: textMessage('assistant', 'a1', 'ok', { completedAt: 1_700_000_001_000 }) },
      { type: 'usage_update', used: 1, size: 10 },
    ]);
    expect(rows.map((row) => row.role)).toEqual(['user', 'ai']);
    expect(rows.map((row) => row.content)).toEqual(['Reply with exactly: ok', 'ok']);
  });

  test('ignores frames without a usable message', () => {
    const rows = transcriptFromReplay([
      { type: 'message_update' },
      { type: 'message_update', message: { role: 'assistant' } },
      { type: 'tool_execution_start', toolCallId: 't1' },
    ]);
    expect(rows).toEqual([]);
  });
});
