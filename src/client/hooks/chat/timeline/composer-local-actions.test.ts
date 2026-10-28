/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What the composer answers and does LOCALLY, before anything reaches the RPC
 * bridge: the TUI-only slash refusal, the undo confirmation gate, and the
 * queue-row actions.
 *
 * The refusal exists because forwarding `/hotkeys` is not a no-op — omp's
 * `session.prompt()` has no slash handling for it, so the model receives the
 * literal string and improvises a turn around it (measured: it read omp's own
 * docs and ran bash). The guard answers with a notice row and stops the send.
 *
 * The undo gate holds a modal open until the rewind settles. A REFUSAL is a
 * result, not a slow request: the endpoint answers 400 with a reason, and the
 * old contract turned that into a modal that simply never closed. A second
 * confirm while one is in flight must be ignored, or a double click rewinds
 * twice.
 *
 * The queue actions act on ONE row: editing lifts it back into the composer
 * and drops it, and "send now" removes it FIRST (delivering without removing
 * would deliver the row twice), lifts the Stop hold, and then delivers by
 * transport — steer on an omp session, abort-then-send on a legacy one.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import type { Dispatch, SetStateAction } from 'preact/compat';
import { appendTuiOnlyNotice, blockTuiOnlySend } from '@/client/hooks/chat/timeline/tui-only-guard';
import { useUndoConfirmation } from '@/client/hooks/chat/timeline/undo-confirmation';
import { createQueueActions, type QueueActions, type QueueActionsDeps } from '@/client/hooks/chat/timeline/queue-actions';
import type { Attachment, ChatMessageData, QueuedMessage } from '@/shared/types';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event', 'CustomEvent'] as const;
/** The runner's own globals, restored on teardown so later files still have them. */
const native: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

/** The undo gate's surface. `undo-confirmation.ts` exports only the hook, so
 *  the shape a caller sees is restated here rather than read off the function. */
interface UndoGate {
  pendingUndo: { id: string; content: string } | null;
  undoing: boolean;
  error: string | null;
  requestUndo: (id: string, content?: string) => void;
  closeUndoConfirm: () => void;
  confirmUndo: () => Promise<void>;
}

const originalSetTimeout = globalThis.setTimeout;
let container: HTMLElement | undefined;

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in native)) native[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (native[key] === undefined) delete target[key];
    else target[key] = native[key];
  }
  globalThis.setTimeout = originalSetTimeout;
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
  globalThis.setTimeout = originalSetTimeout;
});

/** Minimal state setter stand-in: applies updaters the way `useState` would.
 *  The guard appends into the caller's list, so every assertion needs the list
 *  the real component would hold after the call. */
function makeStore(initial: ChatMessageData[] = []): {
  messages: ChatMessageData[];
  set: Dispatch<SetStateAction<ChatMessageData[]>>;
} {
  const box = { messages: initial };
  const set: Dispatch<SetStateAction<ChatMessageData[]>> = (next) => {
    box.messages = typeof next === 'function'
      ? (next as (prev: ChatMessageData[]) => ChatMessageData[])(box.messages)
      : next;
  };
  return {
    get messages() { return box.messages; },
    set,
  };
}

describe('blockTuiOnlySend', () => {
  test('a TUI-only command is refused, appends one notice, and stops the send', () => {
    const store = makeStore();
    expect(blockTuiOnlySend('/hotkeys', store.set)).toBe(true);
    expect(store.messages).toHaveLength(1);
    expect(store.messages[0].role).toBe('ai');
    expect(store.messages[0].content).toBe('');
    expect(store.messages[0].notice).toContain('`/hotkeys`');
    expect(store.messages[0].notice).toContain('omp terminal only');
  });

  test('the reason names the command the user typed', () => {
    const store = makeStore();
    blockTuiOnlySend('/clear', store.set);
    expect(store.messages[0].notice).toContain('`/clear`');
  });

  test('a normal command passes through untouched', () => {
    const store = makeStore();
    expect(blockTuiOnlySend('/help me write a parser', store.set)).toBe(false);
    expect(store.messages).toHaveLength(0);
  });

  test('plain prose is not a command and passes through', () => {
    const store = makeStore();
    expect(blockTuiOnlySend('what does /clear do?', store.set)).toBe(false);
    expect(store.messages).toHaveLength(0);
  });

  test('a chamber-owned command is never refused', () => {
    // `/btw` is TUI-only in omp, but Kabmo answers it itself.
    const store = makeStore();
    expect(blockTuiOnlySend('/btw how does this work', store.set)).toBe(false);
    expect(store.messages).toHaveLength(0);
  });

  test('re-refusing the same command does not stack a duplicate row', () => {
    const store = makeStore();
    blockTuiOnlySend('/exit', store.set);
    blockTuiOnlySend('/exit', store.set);
    expect(store.messages).toHaveLength(1);
  });

  test('the guard does not remove anything already on screen', () => {
    const store = makeStore([{ id: 'm1', role: 'user', content: 'hi' }]);
    blockTuiOnlySend('/restart', store.set);
    expect(store.messages[0].id).toBe('m1');
    expect(store.messages).toHaveLength(2);
  });
});

describe('appendTuiOnlyNotice', () => {
  test('the appended row carries a fresh id and no content', () => {
    const store = makeStore();
    appendTuiOnlyNotice('/debug', store.set);
    const row = store.messages[0];
    expect(row.id.startsWith('tui-only-')).toBe(true);
    expect(row.content).toBe('');
    expect(row.notice).toBeDefined();
  });

  test('two different commands each get their own row', () => {
    const store = makeStore();
    appendTuiOnlyNotice('/debug', store.set);
    appendTuiOnlyNotice('/pause', store.set);
    expect(store.messages).toHaveLength(2);
    expect(store.messages[0].notice).not.toBe(store.messages[1].notice);
  });
});

describe('useUndoConfirmation', () => {
  let undo: UndoGate | undefined;

  function UndoProbe({ onUndo }: { onUndo: (id: string, content: string) => Promise<boolean> }) {
    undo = useUndoConfirmation(onUndo);
    return null;
  }

  async function open(onUndo: (id: string, content: string) => Promise<boolean>): Promise<void> {
    container ??= document.body.appendChild(document.createElement('div'));
    await act(async () => { render(h(UndoProbe, { onUndo }), container as HTMLElement); });
  }

  test('a request opens the gate with the row it was given', async () => {
    await open(async () => true);
    await act(async () => { undo?.requestUndo('m1', 'the prompt'); });
    expect(undo?.pendingUndo).toEqual({ id: 'm1', content: 'the prompt' });
  });

  test('a request without content opens with an empty one', async () => {
    await open(async () => true);
    await act(async () => { undo?.requestUndo('m1'); });
    expect(undo?.pendingUndo).toEqual({ id: 'm1', content: '' });
  });

  test('a successful undo closes the gate', async () => {
    const calls: string[] = [];
    await open(async (id, content) => { calls.push(`${id}|${content}`); return true; });
    await act(async () => { undo?.requestUndo('m1', 'p'); });
    await act(async () => { await undo?.confirmUndo(); });
    expect(calls).toEqual(['m1|p']);
    expect(undo?.pendingUndo).toBeNull();
    expect(undo?.error).toBeNull();
  });

  test('a refused undo keeps the gate open WITH the reason', async () => {
    await open(async () => false);
    await act(async () => { undo?.requestUndo('m1'); });
    await act(async () => { await undo?.confirmUndo(); });
    expect(undo?.pendingUndo).toEqual({ id: 'm1', content: '' });
    expect(undo?.undoing).toBe(false);
    expect(undo?.error).toContain('Undo failed');
  });

  test('a second confirm while one is in flight is ignored', async () => {
    const pending = Promise.withResolvers<boolean>();
    const calls: string[] = [];
    await open((id) => { calls.push(id); return pending.promise; });
    await act(async () => { undo?.requestUndo('m1'); });
    await act(async () => { void undo?.confirmUndo(); });
    expect(undo?.undoing).toBe(true);
    await act(async () => { void undo?.confirmUndo(); });
    expect(calls).toEqual(['m1']);
    pending.resolve(true);
    await act(async () => {});
    expect(undo?.pendingUndo).toBeNull();
  });

  test('cancelling clears the gate and its reason', async () => {
    await open(async () => false);
    await act(async () => { undo?.requestUndo('m1'); });
    await act(async () => { await undo?.confirmUndo(); });
    await act(async () => { undo?.closeUndoConfirm(); });
    expect(undo?.pendingUndo).toBeNull();
    expect(undo?.error).toBeNull();
  });
});

describe('createQueueActions', () => {
  function queuedRow(id: string, text: string, attachments: Attachment[] = []): QueuedMessage {
    return {
      id,
      text,
      attachments,
      model: { provider: 'p', modelId: 'm1', thinkingLevel: 'auto', accessMode: 'always-ask' },
    };
  }

  function harness(overrides: Partial<QueueActionsDeps> = {}): { actions: QueueActions; log: string[] } {
    const log: string[] = [];
    const deps: QueueActionsDeps = {
      setInputValue: (v) => { log.push(`input:${v}`); },
      setInputAttachments: (next) => {
        log.push(`attach:${(typeof next === 'function' ? next([]) : next).length}`);
      },
      removeMessage: (id) => { log.push(`remove:${id}`); },
      stopHoldRef: { current: true },
      isGenerating: false,
      isOmpSession: true,
      steerOmpAgent: async () => { log.push('steer'); return { ok: true, busy: false }; },
      abortControllerRef: { current: null },
      setGenerating: (v) => { log.push(`generating:${v}`); },
      reportActionError: (message) => { log.push(`error:${message}`); },
      executeSend: async (text, _attachments, options) => {
        log.push(`send:${text}:${options?.model?.modelId ?? 'none'}`);
        return { ok: true, busy: false };
      },
      ...overrides,
    };
    return { actions: createQueueActions(deps), log };
  }

  test('editing lifts the row into the composer and drops the row', () => {
    const { actions, log } = harness();
    actions.handleEditQueueItem(queuedRow('q1', 'draft', [{ id: 'a1', preview: '' }]));
    expect(log).toEqual(['input:draft', 'attach:1', 'remove:q1']);
  });

  test('editing sends nothing and leaves the Stop hold alone', () => {
    const { actions, log } = harness();
    actions.handleEditQueueItem(queuedRow('q1', 'draft'));
    expect(log.some((entry) => entry.startsWith('send:'))).toBe(false);
    expect(log.some((entry) => entry.startsWith('generating:'))).toBe(false);
  });

  test('send-now while idle removes the row, lifts the hold, then delivers', async () => {
    const { actions, log } = harness();
    await actions.handleSendNowQueueItem(queuedRow('q1', 'now'));
    expect(log).toEqual(['remove:q1', 'send:now:m1']);
  });

  test('send-now always lifts the Stop hold', async () => {
    const stopHoldRef = { current: true };
    const { actions } = harness({ stopHoldRef });
    await actions.handleSendNowQueueItem(queuedRow('q1', 'now'));
    expect(stopHoldRef.current).toBe(false);
  });

  test('send-now during a run on an omp session steers instead of sending', async () => {
    const abortControllerRef = { current: null };
    const { actions, log } = harness({ isGenerating: true, isOmpSession: true, abortControllerRef });
    await actions.handleSendNowQueueItem(queuedRow('q1', 'steer me'));
    expect(log).toEqual(['remove:q1', 'steer']);
    expect(abortControllerRef.current).toBeNull();
  });

  test('a refused steer is reported — the row is already gone', async () => {
    // The row is removed before the steer goes out (the user asked it to leave
    // the queue), so a refusal with no report would leave the item gone and
    // nothing running, with nothing on screen to say why.
    const { actions, log } = harness({
      isGenerating: true,
      isOmpSession: true,
      steerOmpAgent: async () => ({ ok: false, busy: false, error: 'waiting on an approval dialog' }),
    });
    await actions.handleSendNowQueueItem(queuedRow('q1', 'steer me'));
    expect(log).toEqual(['remove:q1', 'error:Steer failed: waiting on an approval dialog']);
  });

  test('a successful steer reports nothing', async () => {
    const { actions, log } = harness({ isGenerating: true, isOmpSession: true });
    await actions.handleSendNowQueueItem(queuedRow('q1', 'steer me'));
    expect(log).toEqual(['remove:q1', 'steer']);
  });

  test('an UNACKNOWLEDGED steer is a warning, not a failure', async () => {
    // omp queues a steer before it parks on a blocking dialog, so a late ack
    // means the message is running — reporting it as "failed" would push the
    // user to resend something already in flight.
    const { actions, log } = harness({
      isGenerating: true,
      isOmpSession: true,
      steerOmpAgent: async () => ({ ok: false, busy: false, uncertain: true, error: 'not acknowledged in time — it may still be running' }),
    });
    await actions.handleSendNowQueueItem(queuedRow('q1', 'steer me'));
    expect(log).toEqual(['remove:q1', 'error:Steer not acknowledged in time — it may still be running']);
  });

  test('send-now during a run on a legacy session aborts, stops the run, then sends', async () => {
    const abortControllerRef: { current: AbortController | null } = { current: null };
    const { actions, log } = harness({ isGenerating: true, isOmpSession: false, abortControllerRef });
    abortControllerRef.current = { abort: () => { log.push('abort'); } } as unknown as AbortController;
    // The legacy path defers its send through `setTimeout(…, 0)`. Run the
    // scheduled callback inline instead of waiting on a wall clock, so the
    // ordering assertion is about the code, not about the timer.
    globalThis.setTimeout = ((cb: () => void) => { cb(); return 0; }) as unknown as typeof setTimeout;
    await actions.handleSendNowQueueItem(queuedRow('q1', 'legacy'));
    expect(log).toEqual(['remove:q1', 'abort', 'generating:false', 'send:legacy:m1']);
    expect(abortControllerRef.current).toBeNull();
  });
});
