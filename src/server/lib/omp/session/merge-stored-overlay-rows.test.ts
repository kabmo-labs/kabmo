/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The overlay narrowing. For a session omp owns on disk the transcript lives in
 * the JSONL, so Kabmo's copy only has to carry what omp cannot record
 * there — the user turns (raw composer text, attachment metadata) and the notice
 * rows. Everything else was a mirror written on every `message_end`.
 *
 * The load-bearing property is the EQUIVALENCE below: narrowing the stored copy
 * must not change a single rendered row. `mergeOmpAttachments` is the only
 * reader, and it reads user rows and notices only — if that ever stops being
 * true, this test fails rather than the timeline silently losing turns.
 */

import { describe, expect, test } from 'bun:test';

import { mergeOmpAttachments, overlayRowsForOmpSession, type StoredMessage } from '@/server/lib/omp/session/merge-stored';

const NOTICE = 'Context window: 1000000 tokens (1% used)';

/** The conversation as omp wrote it: the `@agent` turn was delivered as a task
 *  delegation prompt, and the builtin command wrote no entry at all. */
function jsonl(): StoredMessage[] {
  return [
    { id: 'omp-u1', role: 'user', content: 'hello' },
    { id: 'omp-a1', role: 'ai', content: 'hi there' },
    { id: 'omp-u2', role: 'user', content: 'Use the task tool to delegate this request: @agent' },
    { id: 'omp-a2', role: 'ai', content: 'delegated' },
  ];
}

/** The same conversation as Kabmo mirrored it: its own id on the turns the
 *  user typed, the attachment metadata the JSONL cannot carry, and the command's
 *  notice row — which is the only place its output exists at all. */
function storedFull(): StoredMessage[] {
  return [
    { id: 'msg-1-user', role: 'user', content: 'hello' },
    { id: 'omp-a1', role: 'ai', content: 'hi there' },
    {
      id: 'msg-2-user',
      role: 'user',
      content: '@agent',
      attachments: [{ name: 'notes.md', content: '# notes' }],
    },
    { id: 'omp-a2', role: 'ai', content: 'delegated' },
    { id: 'cmdout-1', role: 'ai', content: '', notice: NOTICE },
  ];
}

describe('overlayRowsForOmpSession', () => {
  test('keeps the user turns and the notice rows, in their original order', () => {
    const kept = overlayRowsForOmpSession(storedFull());

    expect(kept.map((m) => m.id)).toEqual(['msg-1-user', 'msg-2-user', 'cmdout-1']);
  });

  test('keeps the attachment metadata the JSONL cannot carry', () => {
    const kept = overlayRowsForOmpSession(storedFull());

    expect(kept[1].attachments).toEqual([{ name: 'notes.md', content: '# notes' }]);
  });

  test('drops every role the merge never reads, including assistant rows', () => {
    const rows: StoredMessage[] = [
      { id: 'u', role: 'user', content: 'ask' },
      { id: 'a', role: 'ai', content: 'answer' },
      { id: 'as', role: 'assistant', content: 'answer' },
      { id: 's', role: 'system', content: 'You are helpful.' },
    ];

    expect(overlayRowsForOmpSession(rows).map((m) => m.id)).toEqual(['u']);
  });

  test('drops a notice with no text and entries that are not objects', () => {
    const rows = [
      null,
      'a bare string',
      42,
      { id: 'blank', role: 'ai', content: '', notice: '   \n  ' },
      { id: 'kept', role: 'ai', content: '', notice: NOTICE },
    ];

    expect(overlayRowsForOmpSession(rows as StoredMessage[]).map((m) => m.id)).toEqual(['kept']);
  });

  test('narrows the stored copy without changing a single rendered row', () => {
    const full = mergeOmpAttachments(jsonl(), JSON.stringify(storedFull()));
    const narrowed = mergeOmpAttachments(
      jsonl(),
      JSON.stringify(overlayRowsForOmpSession(storedFull())),
    );

    expect(narrowed).toEqual(full);
    // The rows only the overlay could supply are still there: the turn as the
    // user typed it (`@agent`, not the delegation prompt omp delivered) and the
    // command notice, which the session file never recorded.
    expect(narrowed.map((m) => m.notice ?? m.content)).toEqual([
      'hello',
      'hi there',
      '@agent',
      NOTICE,
      'delegated',
    ]);
  });
});
