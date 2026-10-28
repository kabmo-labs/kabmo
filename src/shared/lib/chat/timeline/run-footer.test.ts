/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A run footer closes the AI response run, so it renders at the run's own
 * boundary: after every row the run owns — including notice rows omp wrote at
 * its tail — which keeps it immediately before the next user message. A run
 * that is still generating, or a notice-only stretch, gets none.
 */

import { describe, expect, test } from 'bun:test';

import { previousNonNoticeIndex, resolveRunFooters, streamingRowIndex } from '@/shared/lib/chat/timeline/run-footer';
import type { ChatMessageData } from '@/shared/types';

const user = (id: string, startedAt?: number): ChatMessageData => ({ id, role: 'user', content: 'yo', startedAt });
const ai = (id: string, completedAt?: number): ChatMessageData => ({ id, role: 'ai', content: 'hi', completedAt });
const notice = (id: string): ChatMessageData => ({ id, role: 'ai', content: '', notice: 'job done' });

/** Slot message ids, one per timeline index — `null` where no footer renders. */
const owners = (messages: ChatMessageData[], isGenerating = false) =>
  resolveRunFooters(messages, isGenerating).map(slot => slot?.msg.id ?? null);

describe('resolveRunFooters', () => {
  test('renders the run footer after the run, before the next user message', () => {
    expect(owners([user('u1'), ai('a1'), user('u2')])).toEqual([null, 'a1', null]);
  });

  test('renders after a trailing notice row, not before it', () => {
    const messages = [user('u1'), ai('a1'), notice('n1'), user('u2')];
    expect(owners(messages)).toEqual([null, null, 'a1', null]);
  });

  test('renders once per run at the run boundary', () => {
    const messages = [user('u1'), ai('a1'), ai('a2'), notice('n1'), user('u2'), ai('a3')];
    expect(owners(messages)).toEqual([null, null, null, 'a2', null, 'a3']);
  });

  test('measures the run span, falling back to the turn duration', () => {
    const measured = resolveRunFooters([user('u1', 1_000), ai('a1', 61_000)], false);
    expect(measured[1]?.durationMs).toBe(60_000);

    const fallback = resolveRunFooters([user('u1'), { ...ai('a1'), durationMs: 2_500 }], false);
    expect(fallback[1]?.durationMs).toBe(2_500);
  });

  test('holds the footer back while the run is still generating', () => {
    expect(owners([user('u1'), ai('a1')], true)).toEqual([null, null]);
    // A notice row at the tail ends the run but must not settle the footer.
    expect(owners([user('u1'), ai('a1'), notice('n1')], true)).toEqual([null, null, null]);
  });

  test('holds the footer back when the streaming row is spelled `assistant`', () => {
    // `roleFor` spells the rows a JSONL load produces for omp's developer /
    // custom / toolResult entries `assistant` (the live mapper says `ai`), and
    // a run reopened mid-flight has exactly such a row at its tail — the last
    // entry written before the streaming answer. Keying the "still streaming"
    // guard on `ai` settled the footer on a row that was still streaming.
    const committed = (id: string): ChatMessageData => ({ id, role: 'assistant', content: 'note' });
    expect(owners([user('u1'), ai('a1'), committed('d1')], true)).toEqual([null, null, null]);
    expect(owners([user('u1'), committed('t1')], true)).toEqual([null, null]);
    // Once the run settles the footer lands on that same row.
    expect(owners([user('u1'), ai('a1'), committed('d1')], false)).toEqual([null, null, 'd1']);
  });

  test('settles the footer once the run completes', () => {
    expect(owners([user('u1'), ai('a1'), notice('n1')], false)).toEqual([null, null, 'a1']);
  });

  test('gives a notice-only stretch no footer', () => {
    expect(owners([user('u1'), notice('n1'), user('u2')])).toEqual([null, null, null]);
  });

  test('a notice carrying the answer is an ordinary AI row and owns the run', () => {
    const diverted = { ...notice('n1'), model: 'deepseek-v4', usage: { totalTokens: 150_640 } };
    const messages = [user('u1'), ai('a1'), diverted, user('u2')];

    expect(owners(messages)).toEqual([null, null, 'n1', null]);
    // While the run is still generating, the diverted answer streams — not the row before it.
    expect(streamingRowIndex([user('u1'), ai('a1'), diverted])).toBe(2);
  });
});

describe('resolveRunFooters run start', () => {
  /** The footer's run-start fields, read off the single rendered slot. */
  const slotFor = (messages: ChatMessageData[], isGenerating = false) => {
    const slots = resolveRunFooters(messages, isGenerating);
    return slots.find((slot) => slot !== null) ?? null;
  };

  test('points at the user row that opened the run, not at the row before the owner', () => {
    // The shape a real omp run has: thinking → tool call → answer. The owner is
    // the last AI row, so `ownerIndex - 1` is another AI row — which is exactly
    // the check the old retry made, and why it no-opped.
    const messages = [user('u1'), ai('a1'), ai('a2'), ai('a3'), user('u2')];
    const slot = slotFor(messages);

    expect(slot?.ownerIndex).toBe(3);
    expect(slot?.runStartIndex).toBe(0);
    expect(slot?.runUserId).toBe('u1');
  });

  test('keeps the run start across a notice row written mid-run', () => {
    const messages = [user('u1'), ai('a1'), notice('n1'), ai('a2')];
    expect(slotFor(messages)?.runUserId).toBe('u1');
  });

  test('reports no user row for a run the transcript starts in the middle of', () => {
    const slot = slotFor([ai('a1'), ai('a2')]);
    expect(slot?.runStartIndex).toBe(-1);
    expect(slot?.runUserId).toBe('');
  });

  test('joins every AI row of the run into the answer, notices excluded', () => {
    const messages = [
      user('u1'),
      { ...ai('a1'), content: 'first part' },
      notice('n1'),
      { ...ai('a2'), content: 'second part' },
      user('u2'),
    ];
    expect(slotFor(messages)?.answerText).toBe('first part\n\nsecond part');
  });

  test('the answer is not the owner row alone when the owner carries no text', () => {
    // The measured case behind the fix: the last row of the run is a tool call,
    // so copying the owner copied nothing at all.
    const messages = [
      user('u1'),
      { ...ai('a1'), content: 'the actual answer' },
      { ...ai('a2'), content: '', toolCalls: [{ id: 't1', type: 'bash', title: 'run' }] },
    ];
    const slot = slotFor(messages);

    expect(slot?.msg.id).toBe('a2');
    expect(slot?.answerText).toBe('the actual answer');
  });

  test('reads the answer out of a notice when omp diverted the turn text there', () => {
    const diverted = { ...notice('n1'), notice: 'diverted answer', model: 'deepseek-v4' };
    expect(slotFor([user('u1'), diverted])?.answerText).toBe('diverted answer');
  });
});

describe('streamingRowIndex', () => {
  test('skips trailing notice rows so the answer is the streaming row', () => {
    expect(streamingRowIndex([user('u1'), ai('a1'), notice('n1')])).toBe(1);
    expect(streamingRowIndex([user('u1'), notice('n1')])).toBe(0);
  });
});

describe('previousNonNoticeIndex', () => {
  test('skips notice rows when pointing at the previous row', () => {
    expect(previousNonNoticeIndex([user('u1'), ai('a1'), notice('n1'), ai('a2')])).toEqual([-1, 0, 1, 1]);
  });
});
