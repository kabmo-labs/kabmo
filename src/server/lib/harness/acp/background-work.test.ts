/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What a turn hands the background path, and the notice it delivers.
 *
 * The probe's own timing lives in `background-probe.test.ts`; this file covers
 * the facts a turn reads off a closed message and the frames a session moves.
 */

import { describe, expect, test } from 'bun:test';
import {
  backgroundNotice,
  backgroundNoticeFrames,
  spawnsBackgroundWork,
} from '@/server/lib/harness/acp/background-work';

const toolCall = (name: string) => ({
  role: 'assistant',
  content: [{ type: 'toolCall', id: 't1', name }],
});

describe('background work detection', () => {
  test('a spawned subagent tool call is background work', () => {
    expect(spawnsBackgroundWork(toolCall('invoke_subagent'))).toBe(true);
    expect(spawnsBackgroundWork(toolCall('spawn_subagent'))).toBe(true);
  });

  test('an awaited tool call is not', () => {
    expect(spawnsBackgroundWork(toolCall('run_command'))).toBe(false);
    expect(spawnsBackgroundWork({ role: 'assistant', content: [{ type: 'text', text: 'hi' }] })).toBe(false);
    expect(spawnsBackgroundWork(undefined)).toBe(false);
  });
});

describe('delayed notice extraction', () => {
  test('returns only the text past the answer already shown', () => {
    expect(backgroundNotice('Sedang membuat…', 'Sedang membuat…\nBerikut gambarnya')).toBe('Berikut gambarnya');
  });

  test('a replay of the same answer is not a notice', () => {
    expect(backgroundNotice('Sedang membuat…', 'Sedang membuat…')).toBeNull();
  });

  test('a diverged replay is not guessed at', () => {
    expect(backgroundNotice('Sedang membuat…', 'Jawaban lain')).toBeNull();
  });

  test('an empty baseline accepts the whole segment', () => {
    expect(backgroundNotice('', 'Berikut gambarnya')).toBe('Berikut gambarnya');
  });
});

describe('background notice frames', () => {
  test('form a complete run so the client releases its generating flag', () => {
    const frames = backgroundNoticeFrames('Berikut gambarnya');
    expect(frames.map((frame) => frame.type)).toEqual([
      'agent_start',
      'turn_start',
      'message_update',
      'message_end',
      'agent_end',
    ]);
    expect(frames[3]).toMatchObject({
      type: 'message_end',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Berikut gambarnya' }] },
    });
    expect(frames[4]).toMatchObject({ type: 'agent_end', isTerminal: true });
  });
});
