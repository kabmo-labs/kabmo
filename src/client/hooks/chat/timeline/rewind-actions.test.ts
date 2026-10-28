/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The rewind actions' contract, driven through a stubbed `fetch`.
 *
 * Retry was a silent no-op on every multi-row run: it looked for a user row
 * IMMEDIATELY BEFORE the id it was given, while the footer hands over the run's
 * OWNER row (the last AI row of thinking → tool call → answer). Measured on 80
 * real sessions, 45% of runs had no such neighbour — and the button still
 * aborted the live run first, so a click mid-stream stopped the answer and did
 * nothing else.
 *
 * These tests pin the three rules that replaced it: the rewind is posted for the
 * run's own user row, the send happens only after it succeeds, and a refusal is
 * reported instead of swallowed.
 *
 * `handleRetry` is fire-and-forget by design (it is a click handler), so the
 * harness resolves a deferred promise on each observable outcome and the test
 * awaits THAT — never a wall-clock guess.
 */

import { afterEach, describe, expect, test } from 'bun:test';

import { createRewindActions, type RewindActions, type RewindActionsDeps } from '@/client/hooks/chat/timeline/rewind-actions';
import type { Attachment, ChatMessageData, OmpAgentHandle } from '@/shared/types';

const user = (id: string, content = 'do the thing'): ChatMessageData => ({ id, role: 'user', content });
const ai = (id: string, content = 'answer'): ChatMessageData => ({ id, role: 'ai', content });

interface Harness {
  rewinds: Array<{ entryId: string; startedAt?: number }>;
  sent: Array<{ text: string; attachments: Attachment[] }>;
  errors: string[];
  /** Every value the handler put into the composer. */
  drafts: string[];
  messages: ChatMessageData[];
  /** Resolves when the action reaches an observable outcome (a send or a report). */
  settled: Promise<void>;
  actions: RewindActions;
}

function makeHarness(
  messages: ChatMessageData[],
  options: { rewindOk?: boolean; rewindError?: string; isOmpSession?: boolean; sessionId?: string | null } = {},
): Harness {
  const rewinds: Array<{ entryId: string; startedAt?: number }> = [];
  const sent: Array<{ text: string; attachments: Attachment[] }> = [];
  const errors: string[] = [];
  const drafts: string[] = [];
  const state = { current: messages };

  let settle!: () => void;
  const settled = new Promise<void>((resolve) => {
    settle = resolve;
  });

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/rewind')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as { entryId?: string; startedAt?: number };
      rewinds.push({ entryId: body.entryId ?? '', startedAt: body.startedAt });
      if (options.rewindOk === false) {
        return new Response(JSON.stringify({ error: options.rewindError ?? 'Entry not found' }), { status: 400 });
      }
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }
    // The transcript re-read that follows a successful rewind.
    return new Response(JSON.stringify({ session: { messages: [] } }), { status: 200 });
  }) as typeof fetch;

  const deps: RewindActionsDeps = {
    isGenerating: false,
    isOmpSession: options.isOmpSession ?? true,
    sessionId: options.sessionId === undefined ? 'sess-1' : options.sessionId,
    ompAgent: { abort: async () => {} } as unknown as OmpAgentHandle,
    abortControllerRef: { current: null },
    setGenerating: () => {},
    setInputValue: (v) => {
      drafts.push(v);
    },
    setLocalMessages: (next) => {
      state.current = typeof next === 'function' ? (next as (prev: ChatMessageData[]) => ChatMessageData[])(state.current) : next;
    },
    localMessagesRef: state,
    persistMessages: () => {},
    executeSend: async (text, attachments) => {
      sent.push({ text, attachments });
      settle();
      return { ok: true, busy: false };
    },
    reportActionError: (message) => {
      errors.push(message);
      settle();
    },
  };

  return {
    rewinds,
    sent,
    errors,
    drafts,
    settled,
    get messages() {
      return state.current;
    },
    actions: createRewindActions(deps),
  };
}

/** The runner's own fetch, reached through `Bun` so a stub leaked onto the global cannot be mistaken for it. */
const originalFetch = Bun.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('handleRetry', () => {
  test('rewinds the run OWNER row to its own user turn, then re-sends it', async () => {
    // The shape the footer produces: user → thinking → tool call → answer. The
    // footer hands over `runUserId` (u1); the old lookup required u1 to sit
    // directly before the row it was given, which it never does.
    const h = makeHarness([user('u1', 'refactor the loader'), ai('a1'), ai('a2'), ai('a3')]);
    h.actions.handleRetry('u1');
    await h.settled;

    expect(h.rewinds.map((r) => r.entryId)).toEqual(['u1']);
    expect(h.sent.map((s) => s.text)).toEqual(['refactor the loader']);
    expect(h.errors).toEqual([]);
  });

  test('reports instead of sending when the rewind is refused', async () => {
    const h = makeHarness([user('u1'), ai('a1')], { rewindOk: false, rewindError: 'Entry not found or not a user turn in this session' });
    h.actions.handleRetry('u1');
    await h.settled;

    expect(h.sent).toEqual([]);
    expect(h.errors).toEqual(['Retry failed: Entry not found or not a user turn in this session']);
  });

  test('reports a run with no user turn rather than silently doing nothing', async () => {
    const h = makeHarness([ai('a1'), ai('a2')]);
    h.actions.handleRetry('a1');
    await h.settled;

    expect(h.rewinds).toEqual([]);
    expect(h.sent).toEqual([]);
    expect(h.errors).toEqual(['Retry failed: this run has no user turn to re-run.']);
  });

  test('still accepts an AI row id by falling back to the row before it', async () => {
    const h = makeHarness([user('u1', 'legacy call'), ai('a1')]);
    h.actions.handleRetry('a1');
    await h.settled;

    expect(h.rewinds.map((r) => r.entryId)).toEqual(['u1']);
    expect(h.sent.map((s) => s.text)).toEqual(['legacy call']);
  });

  test('carries the stored turn attachments into the re-send', async () => {
    const withImage = { ...user('u1', 'look'), attachments: [{ name: 'shot.png', preview: 'data:image/png;base64,QUJD', type: 'image/png' }] };
    const h = makeHarness([withImage, ai('a1')]);
    h.actions.handleRetry('u1');
    await h.settled;

    expect(h.sent[0]?.attachments).toEqual([{ name: 'shot.png', preview: 'data:image/png;base64,QUJD', type: 'image/png', id: 'attachment-1' }]);
  });
});

describe('handleUndo', () => {
  test('rewinds the given turn and reports success', async () => {
    const h = makeHarness([user('u1'), ai('a1'), user('u2'), ai('a2')]);
    const ok = await h.actions.handleUndo('u2', 'second ask');

    expect(ok).toBe(true);
    expect(h.rewinds.map((r) => r.entryId)).toEqual(['u2']);
    expect(h.errors).toEqual([]);
  });

  test('reports a refusal and resolves false, so the dialog can stay open', async () => {
    const h = makeHarness([user('u1'), ai('a1')], { rewindOk: false, rewindError: 'Entry not found or not a user turn in this session' });
    const ok = await h.actions.handleUndo('u1', 'first ask');

    expect(ok).toBe(false);
    expect(h.errors).toEqual(['Undo failed: Entry not found or not a user turn in this session']);
  });

  test('does NOT put the text back into the composer when the rewind failed', async () => {
    // The reported confusion: the draft appeared in the input while the turn it
    // came from was still on screen, so the undo read as half-done and had to be
    // cleared by hand.
    const h = makeHarness([user('u1'), ai('a1')], { rewindOk: false });
    await h.actions.handleUndo('u1', 'first ask');

    expect(h.drafts).toEqual([]);
  });

  test('restores the text only after the rewind succeeded', async () => {
    const h = makeHarness([user('u1'), ai('a1')]);
    await h.actions.handleUndo('u1', 'first ask');

    expect(h.drafts).toEqual(['first ask']);
  });

  test('applies an EMPTY truncated transcript, so the undone rows leave the screen', async () => {
    // Undoing the turn that opened the session (or its only turn) leaves zero
    // rows on disk. A `length > 0` guard treated that as "no answer" and kept
    // the client's copy, so the user bubble and the aborted turn stayed in the
    // timeline until a reload re-read the file — the reported bug.
    const h = makeHarness([user('u1'), ai('a1')]);
    await h.actions.handleUndo('u1', 'first ask');

    expect(h.messages).toEqual([]);
  });

  test('sends the row clock, so a cut the session file does not carry can resolve', async () => {
    const commandRow: ChatMessageData = { id: 'msg-100-user', role: 'user', content: '/usage', startedAt: 1_000 };
    const h = makeHarness([commandRow, ai('a1')]);
    await h.actions.handleUndo('msg-100-user', '/usage');

    expect(h.rewinds).toEqual([{ entryId: 'msg-100-user', startedAt: 1_000 }]);
  });

  test('a non-omp session trims the timeline without a rewind request', async () => {
    const h = makeHarness([user('u1'), ai('a1'), user('u2')], { isOmpSession: false, sessionId: '42' });
    const ok = await h.actions.handleUndo('u2');

    expect(ok).toBe(true);
    expect(h.rewinds).toEqual([]);
    expect(h.messages.map((m) => m.id)).toEqual(['u1', 'a1']);
  });
});
