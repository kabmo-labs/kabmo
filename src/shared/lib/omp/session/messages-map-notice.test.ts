/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `noticeFromCustomMessage` — the JSONL reload branch for `custom_message` and
 * `custom` entries.
 *
 * Split from `messages-map.test.ts` when the file reached the 350-line ceiling.
 * Pinned here: runtime plumbing and Kabmo's mode bookkeeping never reach the
 * timeline, notice text loses ANSI and the `system-notice` wrapper, and a peer
 * agent's `irc:incoming` entry becomes a message card from `details` rather than
 * printing omp's `<irc>` prompt envelope.
 */

import { describe, expect, test } from 'bun:test';

import { noticeFromCustomMessage } from '@/shared/lib/omp/session/messages-map';

describe('noticeFromCustomMessage', () => {
  test('drops session_exit and Kabmo mode bookkeeping entries', () => {
    expect(noticeFromCustomMessage({ customType: 'session_exit', content: 'bye' })).toBeNull();
    expect(noticeFromCustomMessage({ customType: 'chamber-goal-state', content: 'x' })).toBeNull();
    expect(noticeFromCustomMessage({ customType: 'chamber-plan-state', content: 'x' })).toBeNull();
  });

  test('strips ANSI and the system-notice wrapper from the text', () => {
    const msg = noticeFromCustomMessage({ customType: 'launch-completion', id: 'n1', timestamp: '2026-01-02T03:04:05.000Z', content: '\u001b[31mred\u001b[0m' });
    expect(msg).toEqual({ id: 'n1', role: 'ai', content: '', notice: 'red', noticeSource: 'launch-completion', date: '2026-01-02T03:04:05.000Z' });
  });

  test('joins text blocks and ignores non-text blocks', () => {
    const msg = noticeFromCustomMessage({ customType: 'goal-continuation', content: [{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }] });
    expect(msg?.notice).toBe('ab');
    expect(msg?.noticeSource).toBe('goal-continuation');
  });

  test('drops an entry with no prose', () => {
    expect(noticeFromCustomMessage({ customType: 'x', content: '   ' })).toBeNull();
    expect(noticeFromCustomMessage({ customType: 'x', content: { type: 'text', text: 'a' } })).toBeNull();
  });

  test('an entry with no customType is still a notice, without a source', () => {
    const msg = noticeFromCustomMessage({ content: 'hi' });
    expect(msg?.notice).toBe('hi');
    expect(msg?.noticeSource).toBeUndefined();
  });

  test('reads a persisted peer message from details, keeping the entry clock', () => {
    const msg = noticeFromCustomMessage({
      customType: 'irc:incoming',
      id: 'irc-1',
      timestamp: '2026-01-02T03:04:05.000Z',
      content: '<irc>\nIncoming IRC message from agent `Sleeper`:\n\ndone\n</irc>',
      details: { id: '159edc11', from: 'Sleeper', message: 'done' },
    });
    expect(msg).toEqual({
      id: 'irc-1',
      role: 'ai',
      content: '',
      notice: 'done',
      noticeSource: 'irc:incoming',
      irc: { id: '159edc11', from: 'Sleeper', message: 'done' },
      date: '2026-01-02T03:04:05.000Z',
    });
  });
});
