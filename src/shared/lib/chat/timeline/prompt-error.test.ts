/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A prompt failure the timeline must DRAW.
 *
 * ACP's silent turn emits `prompt_error` with no `message_end`; before this the
 * callback only logged it, so the assistant bubble stayed empty and the reason
 * was invisible. These cases pin where the failure lands: the optimistic row it
 * would have streamed into, or a dedicated row when the run already answered.
 */

import { describe, expect, test } from 'bun:test';
import type { ChatMessageData } from '@/shared/types';
import { reportPromptError, type PromptErrorDeps } from '@/shared/lib/chat/timeline/prompt-error';
import {
  createOmpAgentCallbacks,
  type OmpAgentCallbacksDeps,
} from '@/shared/lib/chat/timeline/omp-callbacks';

interface MountedPromptError {
  deps: PromptErrorDeps;
  ref: { current: string | null };
  rows: () => ChatMessageData[];
  persisted: () => ChatMessageData[][];
}

function mount(messages: ChatMessageData[], placeholderId: string | null = null): MountedPromptError {
  let rows = messages;
  const persisted: ChatMessageData[][] = [];
  const ref = { current: placeholderId };
  const deps = {
    setLocalMessages: (update: ChatMessageData[] | ((prev: ChatMessageData[]) => ChatMessageData[])) => {
      rows = typeof update === 'function' ? update(rows) : update;
    },
    aiPlaceholderIdRef: ref,
    persistMessages: (next: ChatMessageData[]) => {
      persisted.push(next);
    },
  };
  return {
    deps,
    ref,
    rows: () => rows,
    persisted: () => persisted,
  };
}

const userRow: ChatMessageData = { id: 'u1', role: 'user', content: 'hello' };

describe('reportPromptError', () => {
  test('marks the empty optimistic row and disarms the placeholder', () => {
    const probe = mount([userRow, { id: 'ai1', role: 'ai', content: '' }], 'ai1');
    reportPromptError('The agent ended the turn without sending an answer', probe.deps);

    expect(probe.ref.current).toBeNull();
    expect(probe.rows()).toHaveLength(2);
    expect(probe.rows()[1]?.error).toEqual({ message: 'The agent ended the turn without sending an answer' });
    expect(probe.persisted()).toHaveLength(1);
  });

  test('a completed answer is not relabelled as the failure', () => {
    const probe = mount([userRow, { id: 'ai1', role: 'ai', content: 'the answer' }]);
    reportPromptError('agent crashed', probe.deps);

    expect(probe.rows()).toHaveLength(3);
    expect(probe.rows()[1]?.error).toBeUndefined();
    expect(probe.rows()[2]?.error).toEqual({ message: 'agent crashed' });
  });

  test('a blank trailing row adopts the error instead of stacking a card', () => {
    const probe = mount([userRow, { id: 'ai1', role: 'ai', content: '' }]);
    reportPromptError('agent crashed', probe.deps);

    expect(probe.rows()).toHaveLength(2);
    expect(probe.rows()[1]?.error).toEqual({ message: 'agent crashed' });
  });

  test('the same failure arriving twice does not stack two cards', () => {
    const probe = mount([userRow, { id: 'ai1', role: 'ai', content: 'the answer' }]);
    reportPromptError('agent crashed', probe.deps);
    reportPromptError('agent crashed', probe.deps);

    expect(probe.rows()).toHaveLength(3);
  });

  test('the first, specific reason survives a later generic one', () => {
    const probe = mount([userRow, { id: 'ai1', role: 'ai', content: '' }], 'ai1');
    reportPromptError('401 Unauthorized', probe.deps);
    reportPromptError('The agent ended the turn without sending an answer', probe.deps);

    expect(probe.rows()[1]?.error).toEqual({ message: '401 Unauthorized' });
  });
});

/** The callbacks with every dep defaulted, wiring the three the row needs into
 *  this file's state probe. */
function callbacksFor(probe: MountedPromptError) {
  const deps: OmpAgentCallbacksDeps = {
    setGenerating: () => {},
    setGeneratingVerb: () => {},
    activityRef: { current: '' },
    scrollToBottom: () => {},
    adoptedSessionIdRef: { current: null },
    sessionIdRef: { current: 'sess-1' },
    metaRefreshedRef: { current: null },
    refreshSessionMeta: () => {},
    setLocalMessages: probe.deps.setLocalMessages,
    aiPlaceholderIdRef: probe.ref,
    optimisticUserIdRef: { current: null },
    pendingUserDisplaysRef: { current: [] },
    persistMessages: probe.deps.persistMessages,
    abortControllerRef: { current: null },
    appSettings: {},
    enqueueExtensionDialog: () => {},
    withdrawExtensionDialog: () => {},
    reloadMessages: () => {},
    needsReloadRef: { current: false },
  };
  return createOmpAgentCallbacks(deps);
}

describe('prompt_error / notice wiring', () => {
  test('a silent ACP failure marks the empty assistant row and persists it', () => {
    const probe = mount([userRow, { id: 'ai1', role: 'ai', content: '' }], 'ai1');
    callbacksFor(probe).onPromptError?.('The agent ended the turn without sending an answer');

    expect(probe.ref.current).toBeNull();
    expect(probe.rows()[1]?.error).toEqual({ message: 'The agent ended the turn without sending an answer' });
    expect(probe.persisted()).toHaveLength(1);
  });

  test('a warning notice becomes a row; an info notice does not', () => {
    const probe = mount([userRow]);
    const callbacks = callbacksFor(probe);

    callbacks.onNotice?.('warning', 'provider refused the request');
    callbacks.onNotice?.('info', 'model warmed');

    expect(probe.rows().filter((row) => row.notice)).toEqual([
      expect.objectContaining({ notice: 'provider refused the request' }),
    ]);
  });
});
