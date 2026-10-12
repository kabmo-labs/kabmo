/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * `finalStatus` decides what the panel shows under an answer and whether the
 * promote button is offered, so an abnormal stop read as `complete` would both
 * mislabel a failed turn and offer to branch a conversation from it. The
 * stop-reason vocabulary belongs to omp (and to `turnStoppedAbnormally`), so
 * these cases pin the mapping rather than the wire shape.
 */

import { describe, expect, test } from 'bun:test';

import { finalAnswer, finalStatus } from '@/server/lib/btw/frames';

function assistant(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { role: 'assistant', content: [{ type: 'text', text: 'answer' }], ...over };
}

describe('finalStatus', () => {
  test('a clean turn completes', () => {
    expect(finalStatus([assistant()])).toBe('complete');
  });

  test('a user abort is cancelled, not an error', () => {
    expect(finalStatus([assistant({ stopReason: 'aborted' })])).toBe('cancelled');
  });

  test('a provider error is a failure, not a completed answer', () => {
    expect(finalStatus([assistant({ stopReason: 'error' })])).toBe('error');
  });

  test('an error carried as flat fields is still a failure', () => {
    // omp writes abnormal stops as flat `errorStatus`/`errorMessage` on the
    // message; a bare `stopReason` check would call this one complete.
    expect(finalStatus([assistant({ errorMessage: 'upstream 500', errorStatus: 500 })])).toBe('error');
  });

  test('the newest assistant turn decides', () => {
    expect(finalStatus([assistant({ stopReason: 'aborted' }), assistant()])).toBe('complete');
  });

  test('a frame with no assistant message completes', () => {
    expect(finalStatus([])).toBe('complete');
    expect(finalStatus(undefined)).toBe('complete');
  });
});

describe('finalAnswer', () => {
  test('joins the assistant text parts of the newest turn', () => {
    const messages = [assistant({ content: [{ type: 'text', text: 'one ' }, { type: 'text', text: 'two' }] })];
    expect(finalAnswer(messages, 'streamed')).toBe('one two');
  });

  test('falls back to the streamed text when the frame carries no answer', () => {
    expect(finalAnswer([], 'streamed')).toBe('streamed');
    expect(finalAnswer(undefined, 'streamed')).toBe('streamed');
  });
});
