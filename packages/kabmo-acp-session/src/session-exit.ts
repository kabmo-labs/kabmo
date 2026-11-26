/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What a session emits when its agent process exits without Kabmo asking.
 *
 * The exit is a failure the operator must see, but only when the session was
 * still wanted; a process Kabmo is tearing down reports through the destroy
 * hook instead of a `prompt_error` for a stop the user asked for.
 */

import type { AgentEvent } from '@kabmo-labs/kabmo-omp-contracts/events';
import type { HarnessId } from '@kabmo-labs/kabmo-harness-catalog';
import { noteChildOutcome } from '@/server/lib/sessions/notify.server';

export interface AcpExitInfo {
  code: number | null;
  stderrTail: string;
}

/** The sentence an exit reports, for the operator AND for a coordinator. */
export function acpExitFailureMessage(harness: HarnessId, info: AcpExitInfo): string {
  const detail = info.stderrTail.trim().split('\n').slice(-3).join(' · ');
  return detail || `The ${harness} agent exited (code ${info.code ?? 'signal'})`;
}

export function acpExitFailureFrames(harness: HarnessId, info: AcpExitInfo): AgentEvent[] {
  return [
    { type: 'prompt_error', errorMessage: acpExitFailureMessage(harness, info) },
    { type: 'agent_end', isTerminal: true },
  ];
}

/** What the exit path reads off the session. */
export interface AcpExitHost {
  harness: HarnessId;
  sessionId: string;
  isStreaming: boolean;
  isPromptRunning: boolean;
  emit(event: AgentEvent): void;
}

/**
 * The unwelcome exit: show the operator why, and tell a coordinator its worker
 * stopped. The frames reach CLIENTS only, so without the notice a delegated
 * worker that died mid-turn left its coordinator waiting for work that had
 * already ended. Reported only while a turn is OPEN — a process that exits
 * between turns has no outcome to report.
 *
 * Returns the notice write so a caller can await it; the process callback
 * ignores the value.
 */
export function reportAcpExit(host: AcpExitHost, info: AcpExitInfo): Promise<void> {
  for (const event of acpExitFailureFrames(host.harness, info)) host.emit(event);
  if (!host.isStreaming && !host.isPromptRunning) return Promise.resolve();
  return noteChildOutcome({
    sessionId: host.sessionId,
    status: 'failed',
    failure: acpExitFailureMessage(host.harness, info),
  }).catch((error: unknown) => {
    console.error('[sessions] could not record an ACP child outcome:', error);
  });
}
