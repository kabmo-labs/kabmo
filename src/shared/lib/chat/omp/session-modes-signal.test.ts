/**
 * @license
 * SPDX-License-Identifier: MIT
 *
 * A cold chat has no live agent when the composer reads `/modes`; the first
 * frame after its spawn is `agent_start`, so that frame must ask the composer
 * to re-read the mode ladder.
 */

import { describe, expect, test } from 'bun:test';
import { foldAgentEvent, type OmpAgentFoldDeps } from '@/shared/lib/chat/omp/agent-events';
import { subscribeClientSignal } from '@/client/lib/signals';

function foldDeps(): OmpAgentFoldDeps {
  const noop = () => {};
  const ref = <T,>(value: T) => ({ current: value });
  return {
    setState: noop,
    sessionId: 'acp-cold-chat',
    callbacksRef: { current: {} },
    toolResultsRef: ref(new Map()),
    lastToolMessageRef: ref(null),
    activityRef: ref(''),
    providerRetryVerbRef: ref(null),
    currentThinkingLevelRef: ref(undefined),
    fileMutatingCallsRef: ref(new Set()),
  } as unknown as OmpAgentFoldDeps;
}

describe('session-modes-changed signal', () => {
  test('agent_start re-reads the live mode ladder', () => {
    const seen: string[] = [];
    const off = subscribeClientSignal('session-modes-changed', (payload) => seen.push(payload.sessionId));
    try {
      foldAgentEvent({ type: 'agent_start' } as never, foldDeps());
    } finally {
      off();
    }
    expect(seen).toEqual(['acp-cold-chat']);
  });
});
