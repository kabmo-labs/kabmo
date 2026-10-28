/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The timeline's streaming plumbing: the animation-frame batcher, the
 * module-level coalescer the omp callbacks factory binds per render, and the
 * two fold steps built on them (the mock-SSE chunk callbacks and the
 * `command_output` notice row).
 *
 * Every case here is a dropped or duplicated update: a burst of full-content
 * `message_update` frames that must collapse to the newest payload per message,
 * a terminal frame that must flush BEFORE the pending frame runs, a session
 * switch that must discard the previous session's queued frames, a burst of
 * deltas that must scroll the tail once per frame, and a builtin command's
 * output that must be persisted exactly once.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ChatMessageData } from '@/shared/types';
import type { StreamChunkCallbacks } from '@/client/hooks/chat/stream';
import { createMockStreamCallbacks } from '@/shared/lib/chat/timeline/stream-callbacks';
import { appendNoticeRow } from '@/shared/lib/chat/timeline/command-output';
import {
  bindStreamingCoalescer,
  cancelStreamingCoalescer,
  disposeStreamingCoalescer,
  flushStreamingUpdates,
  queueStreamingUpdate,
} from '@/shared/lib/chat/timeline/stream-coalescer';

let frames: Array<(() => void) | null>;
const realRaf = globalThis.requestAnimationFrame;
const realCancelRaf = globalThis.cancelAnimationFrame;

function drainFrames(): void {
  const queued = frames;
  frames = [];
  for (const fn of queued) fn?.();
}

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
  (globalThis as Record<string, unknown>).requestAnimationFrame = realRaf;
  (globalThis as Record<string, unknown>).cancelAnimationFrame = realCancelRaf;
  cancelStreamingCoalescer();
});

describe('streaming coalescer', () => {
  function bind(): { applied: ChatMessageData[][]; flushes: number[] } {
    const state = { applied: [] as ChatMessageData[][], flushes: [] as number[] };
    bindStreamingCoalescer(
      (((updater: (prev: ChatMessageData[]) => ChatMessageData[]) => {
        state.applied.push(updater([]));
      }) as unknown as (value: ChatMessageData[] | ((prev: ChatMessageData[]) => ChatMessageData[])) => void),
      () => state.flushes.push(1),
    );
    return state;
  }

  test('queues per message and commits the newest full payload on the frame', () => {
    const state = bind();
    queueStreamingUpdate(() => [{ id: 'm1', role: 'ai', content: 'a' }], 'm1');
    queueStreamingUpdate(() => [{ id: 'm1', role: 'ai', content: 'ab' }], 'm1');
    queueStreamingUpdate(() => [{ id: 'm1', role: 'ai', content: 'abc' }], 'm1');

    expect(state.applied.length).toBe(0);
    drainFrames();

    expect(state.applied.length).toBe(1);
    expect(state.applied[0][0].content).toBe('abc');
    expect(state.flushes.length).toBe(1);
  });

  test('flushStreamingUpdates lands the last chunk before the terminal frame', () => {
    const state = bind();
    queueStreamingUpdate(() => [{ id: 'm1', role: 'ai', content: 'last' }], 'm1');

    flushStreamingUpdates();
    drainFrames();
    expect(state.applied.map((batch) => batch[0].content)).toEqual(['last']);
  });

  test('cancelStreamingCoalescer discards the previous session frames', () => {
    const state = bind();
    queueStreamingUpdate(() => [{ id: 'm1', role: 'ai', content: 'stale' }], 'm1');
    cancelStreamingCoalescer();
    drainFrames();

    expect(state.applied).toEqual([]);
    expect(state.flushes).toEqual([]);
  });

  test('dispose applies what is queued, then invalidates the frame', () => {
    const state = bind();
    queueStreamingUpdate(() => [{ id: 'm1', role: 'ai', content: 'final' }], 'm1');
    disposeStreamingCoalescer();
    drainFrames();

    expect(state.applied.map((batch) => batch[0].content)).toEqual(['final']);
    expect(state.flushes.length).toBe(1);
  });
});

interface Harness {
  messages: ChatMessageData[];
  persisted: ChatMessageData[][];
  verbs: string[];
  generating: boolean[];
  abortRef: { current: AbortController | null };
  scrolled: Array<ScrollBehavior | undefined>;
  callbacks: StreamChunkCallbacks;
}

function harness(placeholderId = 'ph'): Harness {
  // One mutable object: the callbacks close over it, so an update that
  // reassigns `messages` is visible to the assertions that follow.
  const state: Harness = {
    messages: [{ id: placeholderId, role: 'ai', content: '' }],
    persisted: [],
    verbs: [],
    generating: [],
    scrolled: [],
    abortRef: { current: new AbortController() },
    callbacks: {},
  };
  state.callbacks = createMockStreamCallbacks({
    aiPlaceholderId: placeholderId,
    setLocalMessages: (update) => {
      state.messages = typeof update === 'function' ? update(state.messages) : update;
    },
    persistMessages: (messages) => state.persisted.push(messages),
    setGenerating: (v) => state.generating.push(v),
    setGeneratingVerb: (v) => state.verbs.push(v),
    abortControllerRef: state.abortRef,
    appSettings: {},
    scrollToBottom: (behavior) => state.scrolled.push(behavior),
  });
  return state;
}

describe('createMockStreamCallbacks', () => {
  test('content chunks accumulate on the placeholder and land on the next frame', () => {
    const h = harness();
    h.callbacks.onContentChunk?.({ delta: 'Hel' });
    h.callbacks.onContentChunk?.({ delta: 'lo' });

    expect(h.messages[0].content).toBe('');
    drainFrames();
    expect(h.messages[0].content).toBe('Hello');
    expect(h.verbs).toEqual(['Writing response', 'Writing response']);
    // Both deltas asked to follow the tail, but a burst scrolls once per frame.
    expect(h.scrolled).toEqual(['smooth']);
  });

  test('thinking chunks append deltas and the end stamps the final thought', () => {
    const h = harness();
    h.callbacks.onThinkingStart?.({ title: 'Thinking' });
    h.callbacks.onThinkingChunk?.({ delta: 'step ' });
    h.callbacks.onThinkingChunk?.({ delta: 'two' });
    drainFrames();
    expect(h.messages[0].thinking).toMatchObject({ thought: 'step two', isGenerating: true });

    h.callbacks.onThinkingEnd?.({ thought: 'step two', summary: 's', duration: '1.4s' });
    drainFrames();
    expect(h.messages[0].thinking).toMatchObject({ thought: 'step two', summary: 's', duration: '1.4s', isGenerating: false });
    expect(h.verbs[0]).toBe('Thinking');
  });

  test('tool chunks append a call and extend the matching call output only', () => {
    const h = harness();
    h.callbacks.onToolStart?.({ id: 't1', type: 'bash', title: 'Diagnostic', status: 'running' });
    h.callbacks.onToolStart?.({ id: 't2', type: 'read_file', title: 'Read File', status: 'running' });
    drainFrames();
    expect(h.messages[0].toolCalls?.map((t) => t.id)).toEqual(['t1', 't2']);

    h.callbacks.onToolOutputChunk?.({ id: 't2', delta: 'ignored' });
    h.callbacks.onToolOutputChunk?.({ id: 't1', delta: 'line' });
    h.callbacks.onToolOutputChunk?.({ id: 't1', delta: '2' });
    drainFrames();

    expect(h.messages[0].toolCalls?.find((t) => t.id === 't1')?.output).toBe('line2');
    expect(h.messages[0].toolCalls?.find((t) => t.id === 't2')?.output).toBe('ignored');

    h.callbacks.onToolEnd?.({ id: 't1', type: 'bash', title: 'Diagnostic', status: 'success', duration: '85ms' });
    drainFrames();
    expect(h.messages[0].toolCalls?.find((t) => t.id === 't1')).toMatchObject({ status: 'success', duration: '85ms' });
  });

  test('onInit retags the placeholder and onDone commits, persists and clears the run', () => {
    const h = harness();
    h.callbacks.onInit?.({ id: 'real-id', role: 'ai', date: 'Today, 10:00' });
    drainFrames();
    expect(h.messages[0].id).toBe('real-id');
    expect(h.messages[0].date).toBe('Today, 10:00');

    const finalMessage: ChatMessageData = { id: 'real-id', role: 'ai', content: 'answer' };
    h.callbacks.onDone?.({ message: finalMessage });

    expect(h.messages[0]).toBe(finalMessage);
    expect(h.persisted.length).toBe(1);
    expect(h.persisted[0][0]).toBe(finalMessage);
    expect(h.generating).toEqual([false]);
    // onDone releases the abort controller so a later Stop cannot target a finished run.
    expect(h.abortRef.current).toBe(null);
  });

  test('onError stops the run without persisting anything', () => {
    const h = harness();
    h.callbacks.onError?.(new Error('boom'));

    expect(h.generating).toEqual([false]);
    expect(h.persisted).toEqual([]);
    expect(h.abortRef.current).toBe(null);
  });
});

describe('appendNoticeRow', () => {
  test('inserts the notice row before the streaming placeholder and persists without it', () => {
    let messages: ChatMessageData[] = [
      { id: 'u1', role: 'user', content: '/context' },
      { id: 'ph', role: 'ai', content: '' },
    ];
    const persisted: ChatMessageData[][] = [];
    appendNoticeRow('Context: 12k tokens', {
      setLocalMessages: (update) => {
        messages = typeof update === 'function' ? update(messages) : update;
      },
      aiPlaceholderIdRef: { current: 'ph' },
      persistMessages: (next) => persisted.push(next),
    });

    expect(messages.length).toBe(3);
    expect(messages[0].id).toBe('u1');
    expect(messages[1].id.startsWith('cmdout-')).toBe(true);
    expect(messages[2].id).toBe('ph');
    expect(messages[1].notice).toBe('Context: 12k tokens');
    expect(persisted.length).toBe(1);
    expect(persisted[0].map((m) => m.id)).toEqual(['u1', messages[1].id]);
  });

  test('appends at the tail when nothing is streaming', () => {
    let messages: ChatMessageData[] = [{ id: 'u1', role: 'user', content: '/usage' }];
    appendNoticeRow('/usage output', {
      setLocalMessages: (update) => {
        messages = typeof update === 'function' ? update(messages) : update;
      },
      aiPlaceholderIdRef: { current: null },
      persistMessages: () => {},
    });

    expect(messages.length).toBe(2);
    expect(messages[1].notice).toBe('/usage output');
  });

  test('re-running the same command with no placeholder does not stack a twin card', () => {
    const existing: ChatMessageData = { id: 'cmdout-1', role: 'ai', content: '', notice: '/usage output' };
    let messages: ChatMessageData[] = [{ id: 'u1', role: 'user', content: '/usage' }, existing];
    let persisted = 0;
    appendNoticeRow('/usage output', {
      setLocalMessages: (update) => {
        messages = typeof update === 'function' ? update(messages) : update;
      },
      aiPlaceholderIdRef: { current: null },
      persistMessages: () => { persisted += 1; },
    });

    expect(messages.length).toBe(2);
    expect(persisted).toBe(0);
  });
});
