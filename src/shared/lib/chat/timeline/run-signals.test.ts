/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `handleResumeStream` and the phrase mirror it shares with the fold.
 *
 * The reported bug, and it was not a flicker. A cold spawn publishes the
 * session topic once the child is reachable; that snapshot calls
 * `onResumeStream`, and the unconditional `setGeneratingVerb('Thinking')`
 * landed on top of the tool's phrase. Because the fold dedupes against
 * `activityRef` — a SEPARATE ref the resume path never touched — the two then
 * disagreed, so every later frame carrying the tool's phrase was dropped as a
 * repeat and the indicator could not recover. Measured: `Running rg …` at
 * t+45 ms, the republish's resume at t+72 ms, and `Thinking…` for the remaining
 * 4.5 s of the call.
 *
 * The guard is only half the fix; the other half is that there is now ONE
 * mirror. These tests exercise `handleResumeStream` directly, so the ordering
 * is explicit — in a browser the republish and the child's first tool frame
 * race each other, and the fixture showed the phrase surviving even with the
 * guard reverted.
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import { handleResumeStream } from '@/shared/lib/chat/timeline/run-signals';
import type { OmpAgentCallbacksDeps } from '@/shared/lib/chat/timeline/omp-callbacks';

/** Every phrase the resume path published, in order. */
let verbs: string[];
/** The shared mirror — what the indicator shows and what the fold dedupes on. */
let activityRef: { current: string };

beforeEach(() => {
  verbs = [];
  activityRef = { current: '' };
});

function deps(overrides: Partial<OmpAgentCallbacksDeps> = {}): OmpAgentCallbacksDeps {
  return {
    setGenerating: () => {},
    setGeneratingVerb: (v) => { activityRef.current = v; verbs.push(v); },
    activityRef,
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
}

describe('handleResumeStream', () => {
  test('a reattach keeps the phrase a live frame already published', () => {
    // A tool named itself; that phrase is what the reader is looking at.
    activityRef.current = 'Running rg -n somepattern';

    handleResumeStream(deps());

    expect(verbs, 'the reattach clobbered the live phrase').toEqual([]);
    expect(activityRef.current).toBe('Running rg -n somepattern');
  });

  test('a reattach with nothing on screen still names the wait', () => {
    // A real reload: committed history is on screen, the phrase is empty.
    handleResumeStream(deps());

    expect(verbs).toEqual(['Thinking']);
    expect(activityRef.current).toBe('Thinking');
  });

  test('the generating UI resumes either way', () => {
    const seen: boolean[] = [];
    handleResumeStream(deps({ setGenerating: (v) => { seen.push(v); } }));
    expect(seen, 'a reattach must resume the generating state').toEqual([true]);
  });
});
