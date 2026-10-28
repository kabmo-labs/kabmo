/**
 * @license
 * SPDX-License-Identifier: MIT
 *
 * Builtin-command output must survive a reload. omp writes NOTHING to the
 * session JSONL for a `/context` or `/usage` turn — the output exists only in
 * the live `command_output` frame — so Kabmo's own copy is the only place
 * it can be kept, and `mergeOmpAttachments` has to splice it back in.
 *
 * The anchor is the user turn that produced it, matched by CONTENT: the
 * Kabmo's optimistic user row carries a `msg-…-user` id while the JSONL
 * records omp's timestamp id, so an id match never fires.
 */

import { describe, expect, test } from 'bun:test';

import { mergeOmpAttachments, type StoredMessage } from '@/server/lib/omp/session/merge-stored';

const CONTEXT_NOTICE = 'Context window: 1000000 tokens (1% used)';

/** What the JSONL yields for a turn whose command wrote no entry. */
function jsonlTurn(): StoredMessage[] {
  return [
    { id: 'omp-user-1', role: 'user', content: '/context' },
    { id: 'omp-ai-1', role: 'ai', content: 'Done.' },
  ];
}

/** The Kabmo's own copy of that same conversation, plus the notice row. */
function storedWithNotice(): string {
  const stored: StoredMessage[] = [
    { id: 'msg-1-user', role: 'user', content: '/context' },
    { id: 'cmdout-1', role: 'ai', content: '', notice: CONTEXT_NOTICE },
    { id: 'omp-ai-1', role: 'ai', content: 'Done.' },
  ];
  return JSON.stringify(stored);
}

describe('mergeOmpAttachments notice restoration', () => {
  test('splices a stored notice back under its user turn', () => {
    const merged = mergeOmpAttachments(jsonlTurn(), storedWithNotice());

    expect(merged.map((m) => m.notice ?? m.content)).toEqual([
      '/context',
      CONTEXT_NOTICE,
      'Done.',
    ]);
  });

  test('leaves a conversation with no stored notices untouched', () => {
    const stored = JSON.stringify([{ id: 'msg-1-user', role: 'user', content: '/context' }]);
    const merged = mergeOmpAttachments(jsonlTurn(), stored);
    expect(merged.some((m) => m.notice !== undefined)).toBe(false);
    expect(merged).toHaveLength(2);
  });

  test('does not duplicate a notice the JSONL itself carried', () => {
    const messages: StoredMessage[] = [
      { id: 'omp-user-1', role: 'user', content: 'run it' },
      { id: 'omp-notice-1', role: 'ai', content: '', notice: CONTEXT_NOTICE },
    ];
    const merged = mergeOmpAttachments(messages, storedWithNotice());
    expect(merged.filter((m) => m.notice === CONTEXT_NOTICE)).toHaveLength(1);
  });

  test('appends an unanchorable notice instead of dropping it', () => {
    // The stored user turn has no counterpart in the JSONL at all (omp rewrote
    // or pruned it), so there is nothing to anchor to — the row must still show.
    const stored = JSON.stringify([
      { id: 'msg-x', role: 'user', content: 'a turn the JSONL never recorded' },
      { id: 'cmdout-x', role: 'ai', content: '', notice: 'Orphan notice' },
    ]);
    const merged = mergeOmpAttachments(jsonlTurn(), stored);
    expect(merged.map((m) => m.notice).filter(Boolean)).toContain('Orphan notice');
  });

  test('tolerates malformed stored JSON', () => {
    const merged = mergeOmpAttachments(jsonlTurn(), '{not json');
    expect(merged).toHaveLength(2);
  });
});
