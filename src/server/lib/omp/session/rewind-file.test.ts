/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The rewind cut-point contract.
 *
 * A rewind truncates the session JSONL back to just before a user turn. Two
 * record shapes carry one, and the second is why this module exists: omp
 * expands `/skill:<name>` into a `custom_message` record and writes NO user
 * message for it, so the route's original `message.role === 'user'` test
 * refused every skill turn with `entry_not_found` — and the Undo button, whose
 * only feedback was the modal staying open, did nothing at all.
 *
 * The other half of the contract is what a cut must NOT touch: a non-turn
 * record (an assistant message, a tool result) is never a cut point, so a
 * mistyped id cannot silently truncate the transcript at an arbitrary record.
 */

import { describe, expect, test } from 'bun:test';

import {
  isRewindCutPoint,
  pruneStoredAfterCut,
  survivingUserTexts,
  truncateSessionBody,
  userEntryText,
} from '@/server/lib/omp/session/rewind-file';
import { userTurnsRelate } from '@/shared/lib/chat/timeline/turns';

/** One JSONL body from the given records. */
const body = (...records: Record<string, unknown>[]) => `${records.map((r) => JSON.stringify(r)).join('\n')}\n`;

const userEntry = (id: string, text = 'hello', timestamp = '2026-01-01T00:00:00.000Z') => ({
  id,
  type: 'message',
  timestamp,
  message: { role: 'user', content: text },
});
const assistantEntry = (id: string) => ({ id, type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] } });
const skillEntry = (id: string) => ({ id, type: 'custom_message', customType: 'skill-prompt', content: '# Red Engineer' });
const header = (type: string, value: unknown) => ({ type, ...(type === 'thinking_level_change' ? { thinkingLevel: value } : { model: value }) });

/** Parse a truncated body back into records. */
const records = (out: { body: string } | null) => (out?.body ?? '').split('\n').filter(Boolean).map((line) => JSON.parse(line));

describe('isRewindCutPoint', () => {
  test('accepts an ordinary user message', () => {
    expect(isRewindCutPoint(userEntry('u1'))).toBe(true);
  });

  test('accepts the custom record omp writes for an expanded skill', () => {
    expect(isRewindCutPoint(skillEntry('s1'))).toBe(true);
  });

  test('refuses an assistant message and a non-skill custom record', () => {
    expect(isRewindCutPoint(assistantEntry('a1'))).toBe(false);
    expect(isRewindCutPoint({ id: 'c1', type: 'custom', customType: 'session_exit' })).toBe(false);
    expect(isRewindCutPoint(null)).toBe(false);
  });

  test('refuses a message whose role is missing or not user', () => {
    expect(isRewindCutPoint({ id: 'x', type: 'message' })).toBe(false);
    expect(isRewindCutPoint({ id: 'x', type: 'message', message: { role: 'toolResult' } })).toBe(false);
  });
});

describe('truncateSessionBody', () => {
  test('drops the cut turn and everything after it', () => {
    const out = truncateSessionBody(body(header('session', 'x'), userEntry('u1'), assistantEntry('a1'), userEntry('u2')), { entryId: 'u2' });
    expect(records(out).map((r) => r.id ?? r.type)).toEqual(['session', 'u1', 'a1']);
  });

  test('cuts at a skill turn, which the route used to refuse', () => {
    const out = truncateSessionBody(body(userEntry('u1'), assistantEntry('a1'), skillEntry('s1'), assistantEntry('a2')), { entryId: 's1' });
    expect(out).not.toBeNull();
    expect(records(out).map((r) => r.id ?? r.type)).toEqual(['u1', 'a1']);
  });

  test('carries the LAST model/thinking change across the cut', () => {
    const out = truncateSessionBody(
      body(
        header('model_change', 'old'),
        userEntry('u1'),
        header('model_change', 'new'),
        header('thinking_level_change', 'high'),
      ),
      { entryId: 'u1' },
    );
    const carried = records(out).slice(1);
    expect(carried).toEqual([
      { type: 'model_change', model: 'new' },
      { type: 'thinking_level_change', thinkingLevel: 'high' },
    ]);
  });

  test('refuses an unknown id that carries no clock, and a record that cannot start a turn', () => {
    expect(truncateSessionBody(body(userEntry('u1'), assistantEntry('a1')), { entryId: 'nope' })).toBeNull();
    expect(truncateSessionBody(body(userEntry('u1'), assistantEntry('a1')), { entryId: 'a1' })).toBeNull();
  });
});

describe('truncateSessionBody: a cut the session FILE does not carry', () => {
  /** Two file turns a minute apart, so a clock can sit between them. */
  const twoTurns = () => body(
    userEntry('u1', 'first', '2026-01-01T00:00:00.000Z'),
    assistantEntry('a1'),
    userEntry('u2', 'second', '2026-01-01T00:10:00.000Z'),
    assistantEntry('a2'),
  );

  test('resolves a client-side row id by its clock, cutting at the next file turn', () => {
    // A builtin command (`/usage`, `/compact`) writes no entry: its timeline row
    // lives only in Kabmo overlay, and the rewind used to answer
    // entry_not_found for exactly the row the user clicked.
    const out = truncateSessionBody(twoTurns(), { entryId: 'msg-1790-user', startedAt: Date.parse('2026-01-01T00:05:00.000Z') });
    expect(out).not.toBeNull();
    expect(records(out).map((r) => r.id ?? r.type)).toEqual(['u1', 'a1']);
    expect(out?.droppedEntryIds).toEqual(['u2']);
  });

  test('a clock past every turn cuts at the end, removing nothing from the file', () => {
    const out = truncateSessionBody(twoTurns(), { entryId: 'msg-late-user', startedAt: Date.parse('2026-02-01T00:00:00.000Z') });
    expect(records(out).map((r) => r.id ?? r.type)).toEqual(['u1', 'a1', 'u2', 'a2']);
    expect(out?.droppedEntryIds).toEqual([]);
  });

  test('a clock before every turn cuts at the first one', () => {
    const out = truncateSessionBody(twoTurns(), { entryId: 'msg-early-user', startedAt: Date.parse('2025-12-31T00:00:00.000Z') });
    expect(records(out).map((r) => r.id ?? r.type)).toEqual([]);
    expect(out?.droppedEntryIds).toEqual(['u1', 'u2']);
  });

  test('the overlay boundary is the REQUESTED row clock when the file cannot name it', () => {
    // Undoing the first `/usage` (16:00) must also remove the 16:01 one, so the
    // boundary is the requested row's clock — not the next file turn's (16:10).
    const requested = Date.parse('2026-01-01T00:05:00.000Z');
    const out = truncateSessionBody(twoTurns(), { entryId: 'msg-1790-user', startedAt: requested });
    expect(out?.overlayCutClock).toBe(requested);
  });

  test('the overlay boundary is the cut turn clock when the file names it', () => {
    const out = truncateSessionBody(twoTurns(), { entryId: 'u2' });
    expect(out?.overlayCutClock).toBe(Date.parse('2026-01-01T00:10:00.000Z'));
  });
});

describe('pruneStoredAfterCut', () => {
  type PruneCut = Omit<Parameters<typeof pruneStoredAfterCut>[1], 'relates'>;
  const prune = (stored: Parameters<typeof pruneStoredAfterCut>[0], cut: PruneCut) =>
    pruneStoredAfterCut(stored, { relates: userTurnsRelate, ...cut });

  test('drops the requested row and the file turns the cut removed', () => {
    const stored = [
      { id: 'u1', role: 'user', content: 'first', startedAt: 1_000 },
      { id: 'u2', role: 'user', content: 'second', startedAt: 2_000 },
      { id: 'n1', role: 'ai', notice: 'job done' },
    ];
    const out = prune(stored, { requestedId: 'u2', droppedEntryIds: ['u2'], cutClock: 2_000, keptUserTexts: ['first'] });
    expect(out.map((r) => r.id)).toEqual(['u1', 'n1']);
  });

  test('keeps a client-side command turn ABOVE the cut', () => {
    // The reported bug: the overlay holds `/usage` rows that no file entry
    // backs, so a text-only test deleted them or left the ones below the cut
    // alive. Placement is by clock.
    const stored = [
      { id: 'msg-1000-user', role: 'user', content: '/usage', startedAt: 1_000 },
      { id: 'msg-3000-user', role: 'user', content: '/usage', startedAt: 3_000 },
    ];
    const out = prune(stored, { requestedId: 'u2', droppedEntryIds: [], cutClock: 2_000, keptUserTexts: [] });
    expect(out.map((r) => r.id)).toEqual(['msg-1000-user']);
  });

  test('removes the undone command turn, so a reload cannot resurrect it', () => {
    const stored = [
      { id: 'msg-1000-user', role: 'user', content: '/compact', startedAt: 1_000 },
      { id: 'msg-5000-user', role: 'user', content: '/usage', startedAt: 5_000 },
    ];
    const out = prune(stored, { requestedId: 'msg-5000-user', droppedEntryIds: [], cutClock: 5_000, keptUserTexts: [] });
    expect(out.map((r) => r.id)).toEqual(['msg-1000-user']);
  });

  test('a legacy row with no clock falls back to text relatedness', () => {
    const stored = [{ id: 'legacy', role: 'user', content: 'kept prompt' }];
    expect(prune(stored, { requestedId: 'x', droppedEntryIds: [], cutClock: 9_999, keptUserTexts: ['kept prompt'] })).toHaveLength(1);
    expect(prune(stored, { requestedId: 'x', droppedEntryIds: [], cutClock: 9_999, keptUserTexts: ['other'] })).toHaveLength(0);
  });

  test('never drops an assistant or notice row', () => {
    const stored = [{ id: 'a1', role: 'ai', content: 'answer' }, { id: 'n1', role: 'ai', notice: 'x' }];
    expect(prune(stored, { requestedId: 'a1', droppedEntryIds: [], cutClock: 1, keptUserTexts: [] })).toHaveLength(2);
  });
});

describe('survivingUserTexts', () => {
  test('reads the user turns left in a body, a skill record included', () => {
    // A `skill-prompt` record IS a user turn, and its text is the record's own
    // content (there is no `message` wrapper to read).
    expect(survivingUserTexts(body(userEntry('u1', 'kept'), skillEntry('s1'), assistantEntry('a1'))))
      .toEqual(['kept', '# Red Engineer']);
  });
});

describe('userEntryText', () => {
  test('reads a string body and text blocks alike', () => {
    expect(userEntryText('plain')).toBe('plain');
    expect(userEntryText([{ type: 'text', text: 'a' }, { type: 'image', data: 'x' }, { type: 'text', text: 'b' }])).toBe('ab');
    expect(userEntryText(undefined)).toBe('');
  });
});
