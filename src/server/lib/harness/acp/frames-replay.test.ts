/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The mapper in RESTORE mode.
 *
 * A live `user_message` frame is a receipt: the composer already drew the
 * bubble, so the mapper emits nothing. During a replay it is the ONLY copy of
 * the user turn — measured on codex and claude, where the adapter sends an
 * empty `user_message` followed by a `user_message_chunk` — and dropping it
 * restored a conversation that was missing every question.
 */

import { describe, expect, test } from 'bun:test';
import { AcpFrameMapper } from '@kabmo-labs/kabmo-acp-mapper/frames';

const chunk = (text: string, messageId = 'u1') => ({
  sessionUpdate: 'user_message_chunk',
  messageId,
  content: { type: 'text', text },
});

describe('replayed user turns', () => {
  test('live mode emits nothing for a user frame', () => {
    const mapper = new AcpFrameMapper();
    expect(mapper.mapUpdate(chunk('hello'))).toEqual([]);
  });

  test('replay opens one user row and appends its chunks', () => {
    const mapper = new AcpFrameMapper();
    mapper.setReplaying(true);
    // Codex's first frame carries the id and no content.
    expect(mapper.mapUpdate({ sessionUpdate: 'user_message', messageId: 'u1', content: [] })).toEqual([]);
    const opened = mapper.mapUpdate(chunk('hello'));
    expect(opened).toHaveLength(1);
    expect(opened[0].type).toBe('message_start');
    expect((opened[0].message as { role: string }).role).toBe('user');
    expect((opened[0].message as { content: unknown }).content).toEqual([{ type: 'text', text: 'hello' }]);

    const next = mapper.mapUpdate(chunk(' world'));
    expect(next).toHaveLength(1);
    expect(next[0].type).toBe('message_update');
    expect((next[0].message as { content: unknown }).content).toEqual([{ type: 'text', text: 'hello world' }]);
  });

  test('leaving replay mode stops materializing user frames', () => {
    const mapper = new AcpFrameMapper();
    mapper.setReplaying(true);
    mapper.mapUpdate(chunk('once'));
    mapper.setReplaying(false);
    expect(mapper.mapUpdate(chunk('twice'))).toEqual([]);
  });
});
