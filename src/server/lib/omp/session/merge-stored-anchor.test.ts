/**
 * @license
 * SPDX-License-Identifier: MIT
 *
 * Where an unmatched raw turn lands.
 *
 * omp answers a builtin on the command path and writes NO session entry for it,
 * so `/usage` or `/compact` exists only in Kabmo's own copy — no JSONL
 * user turn relates to it, and it cannot be matched into place. It was
 * positioned by scanning the stored array forward for the next row the JSONL
 * carried, which only worked because the overlay also held the mirrored rows —
 * the very rows `overlayRowsForOmpSession` drops. So this is the regression the
 * narrowing introduced: those turns fell to the END of the timeline, after
 * answers that came later. The clock fixes it, and the two tests below are the
 * behaviour and the equivalence.
 */

import { describe, expect, test } from 'bun:test';

import { mergeOmpAttachments, overlayRowsForOmpSession, type StoredMessage } from '@/server/lib/omp/session/merge-stored';

/** Arbitrary epoch ms, one second per step, so the order is exact. */
const at = (second: number) => 1_790_000_000_000 + second * 1000;

/** The conversation omp recorded. `/usage` is absent: a builtin writes nothing. */
function jsonl(): StoredMessage[] {
  return [
    { id: 'omp-u1', role: 'user', content: 'first question', startedAt: at(0) },
    { id: 'omp-a1', role: 'ai', content: 'first answer', startedAt: at(1) },
    { id: 'omp-u2', role: 'user', content: 'second question', startedAt: at(30) },
    { id: 'omp-a2', role: 'ai', content: 'second answer', startedAt: at(31) },
  ];
}

/** The Kabmo's copy of the same timeline, built in the order it was lived:
 *  mirrors and local rows interleaved by time. */
function storedFull(): StoredMessage[] {
  return [
    { id: 'msg-1-user', role: 'user', content: 'first question', startedAt: at(0) },
    { id: 'omp-a1', role: 'ai', content: 'first answer', startedAt: at(1) },
    { id: 'msg-2-user', role: 'user', content: '/usage', startedAt: at(2) },
    { id: 'cmdout-1', role: 'ai', content: '', notice: '/usage output', startedAt: at(3) },
    { id: 'msg-3-user', role: 'user', content: 'second question', startedAt: at(30) },
    { id: 'omp-a2', role: 'ai', content: 'second answer', startedAt: at(31) },
  ];
}

const order = (messages: StoredMessage[]) => messages.map((m) => m.notice ?? m.content);

describe('unmatched raw turn placement', () => {
  test('lands where the user sent it, not after the turns that followed', () => {
    const merged = mergeOmpAttachments(jsonl(), JSON.stringify(overlayRowsForOmpSession(storedFull())));

    expect(order(merged)).toEqual([
      'first question',
      'first answer',
      '/usage',
      '/usage output',
      'second question',
      'second answer',
    ]);
  });

  test('narrowing the overlay does not move it', () => {
    const full = mergeOmpAttachments(jsonl(), JSON.stringify(storedFull()));
    const narrowed = mergeOmpAttachments(
      jsonl(),
      JSON.stringify(overlayRowsForOmpSession(storedFull())),
    );

    expect(narrowed).toEqual(full);
  });

  test('a turn with no clock to read still renders rather than being dropped', () => {
    const clockless: StoredMessage[] = [
      { id: 'msg-1-user', role: 'user', content: 'first question', startedAt: at(0) },
      { id: 'msg-2-user', role: 'user', content: '/usage' },
    ];

    const merged = mergeOmpAttachments(jsonl(), JSON.stringify(clockless));

    expect(order(merged)).toContain('/usage');
    expect(merged.some((m) => m.startedAt === at(0))).toBe(true);
  });
});
