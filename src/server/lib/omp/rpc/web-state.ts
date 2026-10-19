/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Folds omp's `get_state` payload into Kabmo's WebSessionState while
 * reconciling the wrapper's own running flags against it. The reconciliation is
 * the point: `isStreaming` alone cannot tell a finished turn from one that is
 * between tool calls, so a session with dispatched-but-unstarted work or an
 * unexpired continuation grace window stays "running".
 *
 * Split from the session wrapper (which satisfies WebStateHost structurally) so
 * rpc-manager.ts stays under the repo's per-file size ceiling.
 */

import type { RpcSessionState, WebSessionState } from '@/server/lib/omp/rpc/constants';

/** Wrapper state the reconciliation reads and writes. */
export interface WebStateHost {
  streaming: boolean;
  compacting: boolean;
  promptRunning: boolean;
  promptDispatchPendingCount: number;
  awaitingAgentStart: boolean;
  awaitingAgentStartDeadline: number;
  continuationGraceUntil: number;
  bashRunning: boolean;
  fastModeEnabled: boolean;
  isRunning(): boolean;
  /** Persist the identity omp reports, when the payload carries one. */
  adoptSessionIdentity(state: RpcSessionState): void;
}

export function buildWebState(host: WebStateHost, state: RpcSessionState): WebSessionState {
  host.streaming = state.isStreaming;
  host.compacting = state.isCompacting;
  host.adoptSessionIdentity(state);

  const awaitingExpired = !host.awaitingAgentStart || Date.now() >= host.awaitingAgentStartDeadline;
  const hasPendingWork =
    host.promptDispatchPendingCount > 0 ||
    (host.awaitingAgentStart && !awaitingExpired);

  if (
    state.isStreaming === false &&
    state.isCompacting === false &&
    !hasPendingWork &&
    Date.now() >= host.continuationGraceUntil
  ) {
    host.promptRunning = false;
    host.awaitingAgentStart = false;
    host.awaitingAgentStartDeadline = 0;
  }

  return {
    sessionId: state.sessionId,
    sessionFile: state.sessionFile ?? '',
    sessionName: state.sessionName,
    isStreaming: state.isStreaming,
    isPromptRunning: host.promptRunning,
    isBashRunning: host.bashRunning,
    isCompacting: state.isCompacting,
    autoCompactionEnabled: state.autoCompactionEnabled,
    autoRetryEnabled: state.autoRetryEnabled,
    interruptMode: state.interruptMode,
    steeringMode: state.steeringMode,
    followUpMode: state.followUpMode,
    model: state.model
      ? {
          id: state.model.id,
          provider: state.model.provider,
          name: state.model.name,
          reasoning: state.model.reasoning,
          thinking: state.model.thinking ? { efforts: state.model.thinking.efforts } : undefined,
        }
      : undefined,
    messageCount: state.messageCount,
    queuedMessageCount: state.queuedMessageCount,
    contextUsage: state.contextUsage ?? null,
    systemPrompt: state.systemPrompt?.join('\n\n') ?? '',
    thinkingLevel: state.thinkingLevel ?? 'off',
    fastModeEnabled: state.fastModeEnabled ?? state.fastMode ?? host.fastModeEnabled,
    fastModeActive: state.fastModeActive,
    tokensPerSecond: state.tokensPerSecond ?? null,
    todoPhases: state.todoPhases ?? [],
  };
}
