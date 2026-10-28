/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The transport/extension frames that would otherwise fall through the fold
 * silently. Each carries a user-visible fact: a dropped frame means the
 * transcript is missing a step, a failed extension means a tool is broken, and
 * a settled session is the moment the optimistic generating state must go.
 */

import { describe, expect, test } from 'bun:test';

import { foldTransportFrame } from '@/shared/lib/chat/omp/transport-frames';
import type { OmpAgentFoldDeps } from '@/shared/lib/chat/omp/fold-deps';
import type { OmpAgentCallbacks, OmpAgentState } from '@/shared/types';

function makeHost() {
  const notices: Array<{ level: string; message: string }> = [];
  let state: OmpAgentState = { isGenerating: true, connected: true, error: null };
  const callbacks: OmpAgentCallbacks = {
    onNotice: (level, message) => notices.push({ level, message }),
  };
  const deps = {
    callbacksRef: { current: callbacks },
    setState: (update: unknown) => {
      state = typeof update === 'function'
        ? (update as (s: OmpAgentState) => OmpAgentState)(state)
        : (update as OmpAgentState);
    },
    activityRef: { current: '' },
    providerRetryVerbRef: { current: null },
  } as unknown as OmpAgentFoldDeps;
  return { host: { foldDeps: deps }, notices, state: () => state };
}

describe('foldTransportFrame', () => {
  test('a dropped frame is reported with the type omp dropped', () => {
    const { host, notices } = makeHost();
    expect(foldTransportFrame({ type: 'rpc_frame_error', originalType: 'agent_end', error: 'too big' }, host)).toBe(true);
    expect(notices).toEqual([{ level: 'warning', message: 'OMP dropped a agent_end frame: it exceeded the transport limit.' }]);
  });

  test('an extension failure names the extension and its error', () => {
    const { host, notices } = makeHost();
    foldTransportFrame({ type: 'extension_error', extensionPath: '/tmp/ext/index.ts', error: 'boom' }, host);
    expect(notices).toEqual([{ level: 'warning', message: '/tmp/ext/index.ts failed: boom' }]);
  });

  test('session_settled releases the generating state', () => {
    const { host, state } = makeHost();
    expect(state().isGenerating).toBe(true);
    foldTransportFrame({ type: 'session_settled' }, host);
    expect(state().isGenerating).toBe(false);
  });

  test('frames with no chamber-side effect are consumed, not leaked', () => {
    const { host, notices } = makeHost();
    for (const type of ['cache_warming_start', 'retry_fallback_applied', 'ttsr_triggered', 'todo_reminder', 'irc_message']) {
      expect(foldTransportFrame({ type }, host)).toBe(true);
    }
    expect(notices).toEqual([]);
  });

  test('an unrelated frame is left to the caller', () => {
    const { host } = makeHost();
    expect(foldTransportFrame({ type: 'agent_start' }, host)).toBe(false);
  });
});
