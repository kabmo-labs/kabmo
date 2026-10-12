/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The run boundaries: the sidebar is NOT signalled from here any more (it
 * follows the realtime topics), while the optimistic `stream` mark still rides
 * the client signal bus — armed on a mid-run reattach, so a resumed fresh spawn
 * draws its spinner before omp has written a session file.
 *
 * One case is driven through `foldAgentEvent` with a real omp frame: the
 * callbacks see the MAPPED chamber role (`assistant` → `ai`), which a
 * hand-built message would hide.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  createOmpAgentCallbacks,
  type OmpAgentCallbacksDeps,
} from '@/shared/lib/chat/timeline/omp-callbacks';
import { foldAgentEvent, type OmpAgentFoldDeps } from '@/shared/lib/chat/omp/agent-events';
import { bindStreamingCoalescer, disposeStreamingCoalescer } from '@/shared/lib/chat/timeline/stream-coalescer';
import { STREAM_PENDING_SIGNAL } from '@/client/hooks/chat/omp/stream-overlay';
import { subscribeClientSignal } from '@/client/lib/signals';
import type { SetStateAction } from 'preact/compat';
import type { ChatMessageData, OmpAgentCallbacks, OmpAgentState } from '@/shared/types';
import type { IncomingExtensionUiRequest } from '@/shared/types/omp/agent';

/** omp's own shape for a completed assistant turn, before the mapper runs. */
const OMP_ASSISTANT_TURN = {
  role: 'assistant',
  content: [{ type: 'text', text: 'hi' }],
  timestamp: 1757943900000,
};

const assistantTurn = (id: string): ChatMessageData => ({ id, role: 'ai', content: 'hi' });
const userTurn = (id: string): ChatMessageData => ({ id, role: 'user', content: 'yo' });
const noticeRow = (id: string): ChatMessageData => ({ id, role: 'ai', content: '', notice: 'job done' });

/** The callbacks with every dep defaulted; overrides patch one behaviour. */
function makeCallbacks(overrides: Partial<OmpAgentCallbacksDeps> = {}): OmpAgentCallbacks {
  const deps: OmpAgentCallbacksDeps = {
    setGenerating: () => {},
    setGeneratingVerb: () => {},
    scrollToBottom: () => {},
    adoptedSessionIdRef: { current: null },
    sessionIdRef: { current: 'sess-1' },
    metaRefreshedRef: { current: null },
    refreshSessionMeta: () => {},
    setLocalMessages: () => {},
    aiPlaceholderIdRef: { current: null },
    optimisticUserIdRef: { current: null },
    pendingUserDisplaysRef: { current: [] },
    persistMessages: () => {},
    abortControllerRef: { current: null },
    appSettings: {},
    enqueueExtensionDialog: () => {},
    withdrawExtensionDialog: () => {},
    ...overrides,
  };
  return createOmpAgentCallbacks(deps);
}

describe('createOmpAgentCallbacks run boundaries', () => {
  const signals: Array<{ name: string; sessionId?: string }> = [];
  let unsubscribe: (() => void) | null = null;

  beforeEach(() => {
    signals.length = 0;
    unsubscribe = subscribeClientSignal(STREAM_PENDING_SIGNAL, (detail) => {
      signals.push({ name: 'stream-pending', sessionId: detail.sessionId });
    });
  });

  afterEach(() => {
    unsubscribe?.();
    unsubscribe = null;
  });

  function makeFoldDeps(callbacks: OmpAgentCallbacks): OmpAgentFoldDeps {
    let state: OmpAgentState = { isGenerating: false, connected: true, error: null };
    return {
      sessionId: 'sess-1',
      setState: (update) => {
        state = typeof update === 'function' ? update(state) : update;
      },
      callbacksRef: { current: callbacks },
      toolResultsRef: { current: new Map<string, { output: string }>() },
      lastToolMessageRef: { current: null },
      activityRef: { current: '' },
      providerRetryVerbRef: { current: null },
      currentThinkingLevelRef: { current: undefined },
      };
  }

  test('a run start no longer signals the sidebar', () => {
    // The sidebar follows the realtime `sidebar:status` topic, which the server
    // publishes on the same status write this dispatch used to announce.
    const callbacks = makeCallbacks();

    callbacks.onAgentStart?.();
    callbacks.onMessageEnd?.(assistantTurn('a1'));
    callbacks.onTurnStart?.();
    callbacks.onMessageEnd?.(userTurn('u1'));
    callbacks.onMessageEnd?.(noticeRow('n1'));

    expect(signals).toHaveLength(0);
  });

  test('re-arms the optimistic mark on a mid-run stream reattach', () => {
    const callbacks = makeCallbacks();

    callbacks.onResumeStream?.();
    callbacks.onMessageEnd?.(assistantTurn('a1'));

    // The reattach arms the sidebar's OPTIMISTIC mark, because a fresh spawn's
    // session is absent from the list payload until omp writes its file (~17s):
    // without the arm the spinner stayed dark for the resumed run while the
    // generating indicator was already showing.
    expect(signals).toEqual([
      { name: 'stream-pending', sessionId: 'sess-1' },
    ]);
  });

  test('a real omp assistant message_end frame signals nothing on its own', () => {
    const deps = makeFoldDeps(makeCallbacks());

    foldAgentEvent({ type: 'agent_start' }, deps);
    foldAgentEvent({ type: 'message_end', message: OMP_ASSISTANT_TURN }, deps);
    foldAgentEvent({ type: 'message_end', message: { ...OMP_ASSISTANT_TURN, timestamp: 1757943901000 } }, deps);

    expect(signals).toHaveLength(0);
  });
});

/**
 * The optimistic user bubble must be reconciled with omp's echo, never left
 * beside it.
 *
 * omp streams the ASSISTANT segment before it re-emits the user turn, so an
 * assistant frame arrives while the optimistic mark is still the only thing
 * that knows which bubble the echo belongs to. Clearing the mark on any
 * non-user frame (the old behaviour, in both `onMessageUpdate` and
 * `onMessageEnd`) made the echo find no bubble and append a second one — the
 * turn rendered twice, and `/api/chat/:id/turns` listed it twice, because the
 * stored optimistic row no longer related to the JSONL echo. Measured on this
 * install: `{"msg-…-user","lanjut"}` and `{"omp-id","lanjut"}` side by side.
 *
 * The mark is now released in exactly two places: the user branch, on the echo
 * it actually names, and `agent_end`.
 */
describe('createOmpAgentCallbacks optimistic user reconciliation', () => {
  const realRaf = globalThis.requestAnimationFrame;
  const realCancelRaf = globalThis.cancelAnimationFrame;
  let frames: Array<(() => void) | null> = [];

  /** Apply every frame the coalescer scheduled. Running the callback INLINE
   *  would break its batching (the batch assigns `frame` after the callback
   *  returns), so the frames are collected and drained here. */
  const drainFrames = () => {
    const queued = frames;
    frames = [];
    for (const fn of queued) fn?.();
  };

  beforeEach(() => {
    frames = [];
    (globalThis as Record<string, unknown>).requestAnimationFrame = (cb: () => void) => {
      frames.push(cb);
      return frames.length;
    };
    (globalThis as Record<string, unknown>).cancelAnimationFrame = (handle: number) => {
      frames[handle - 1] = null;
    };
  });

  afterEach(() => {
    // Dispose BEFORE restoring the real rAF: `disposeStreamingCoalescer` cancels
    // its pending frame through the stub above.
    disposeStreamingCoalescer();
    (globalThis as Record<string, unknown>).requestAnimationFrame = realRaf;
    (globalThis as Record<string, unknown>).cancelAnimationFrame = realCancelRaf;
  });

  function harness() {
    let messages: ChatMessageData[] = [
      { id: 'msg-100-user', role: 'user', content: 'lanjut' },
      { id: 'msg-101-ai', role: 'ai', content: '' },
    ];
    const optimisticUserIdRef = { current: 'msg-100-user' as string | null };
    const setLocalMessages = (update: SetStateAction<ChatMessageData[]>) => {
      messages = typeof update === 'function'
        ? (update as (prev: ChatMessageData[]) => ChatMessageData[])(messages)
        : update;
    };
    // The coalescer's sink is module-level; point it at this harness's state.
    bindStreamingCoalescer(setLocalMessages, () => {});
    const callbacks = makeCallbacks({
      setLocalMessages,
      aiPlaceholderIdRef: { current: 'msg-101-ai' },
      optimisticUserIdRef,
    });
    const users = () => messages.filter(m => m.role === 'user');
    return { callbacks, users, optimisticUserIdRef, drainFrames };
  }

  test('an assistant segment landing before the user echo still reconciles in place', () => {
    const h = harness();

    h.callbacks.onMessageUpdate?.({ id: 'omp-a1', role: 'ai', content: 'hi' });
    h.drainFrames();
    h.callbacks.onMessageUpdate?.({ id: 'omp-u1', role: 'user', content: 'lanjut' });
    h.drainFrames();

    expect(h.users()).toHaveLength(1);
    expect(h.users()[0]?.id).toBe('omp-u1');
    expect(h.optimisticUserIdRef.current).toBeNull();
  });

  test('the message_end path reconciles the same way', () => {
    const h = harness();

    h.callbacks.onMessageEnd?.({ id: 'omp-a1', role: 'ai', content: 'hi' });
    h.callbacks.onMessageEnd?.({ id: 'omp-u1', role: 'user', content: 'lanjut' });

    expect(h.users()).toHaveLength(1);
    expect(h.users()[0]?.id).toBe('omp-u1');
  });

  test('a later steering user turn still appends as its own row', () => {
    const h = harness();

    h.callbacks.onMessageUpdate?.({ id: 'omp-u1', role: 'user', content: 'lanjut' });
    h.drainFrames();
    h.callbacks.onMessageUpdate?.({ id: 'omp-u2', role: 'user', content: 'steer now' });
    h.drainFrames();

    expect(h.users().map(m => m.id)).toEqual(['omp-u1', 'omp-u2']);
  });

  test('agent_end releases the mark so a next send starts clean', () => {
    const h = harness();

    h.callbacks.onMessageEnd?.({ id: 'omp-a1', role: 'ai', content: 'hi' });
    expect(h.optimisticUserIdRef.current).toBe('msg-100-user');

    h.callbacks.onAgentEnd?.({});
    expect(h.optimisticUserIdRef.current).toBeNull();
  });
});

/**
 * Every method omp PARKS on must reach the client's dialog queue.
 *
 * The list is shared with the server (`@/shared/lib/omp/dialog-methods`) and
 * the grouped `ask` frame — the shape `configureChild` opts into with
 * `set_ask_dialog` — was missing from this gate's local copy. The frame was
 * dropped silently, so the ask card had no dialog to render and drew every
 * question as "Waiting for the previous answer…" with no control to answer it,
 * while omp sat blocked on the request. `cancel` stays a withdrawal, not a
 * queue insert.
 */
describe('createOmpAgentCallbacks dialog routing', () => {
  const groupedAsk = {
    type: 'extension_ui_request',
    id: 'frame-1',
    method: 'ask',
    title: '',
    questions: [{ id: 'q1', question: 'Pick a size', options: [{ label: 's' }] }],
  } as unknown as IncomingExtensionUiRequest;

  test('a grouped ask frame is enqueued, not dropped', () => {
    const enqueued: string[] = [];
    const callbacks = makeCallbacks({ enqueueExtensionDialog: (request) => enqueued.push(request.id) });

    callbacks.onExtensionUiRequest?.(groupedAsk);

    expect(enqueued).toEqual(['frame-1']);
  });

  test('every answerable method is enqueued; cancel withdraws instead', () => {
    const enqueued: string[] = [];
    const withdrawn: string[] = [];
    const callbacks = makeCallbacks({
      enqueueExtensionDialog: (request) => enqueued.push(request.method),
      withdrawExtensionDialog: (targetId) => withdrawn.push(targetId),
    });

    for (const method of ['select', 'confirm', 'input', 'editor', 'ask']) {
      callbacks.onExtensionUiRequest?.({ type: 'extension_ui_request', id: `f-${method}`, method, title: 't' } as unknown as IncomingExtensionUiRequest);
    }
    callbacks.onExtensionUiRequest?.({ type: 'extension_ui_request', id: 'c1', method: 'cancel', targetId: 'f-ask' } as unknown as IncomingExtensionUiRequest);
    callbacks.onExtensionUiRequest?.({ type: 'extension_ui_request', id: 'n1', method: 'notify', message: 'hi' } as unknown as IncomingExtensionUiRequest);

    expect(enqueued).toEqual(['select', 'confirm', 'input', 'editor', 'ask']);
    expect(withdrawn).toEqual(['f-ask']);
  });
});
