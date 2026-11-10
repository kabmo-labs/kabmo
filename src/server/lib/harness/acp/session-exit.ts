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

import type { AgentEvent } from '@/server/lib/omp/rpc/constants';
import type { HarnessId } from '@/shared/lib/harness/catalog';

export interface AcpExitInfo {
  code: number | null;
  stderrTail: string;
}

export function acpExitFailureFrames(harness: HarnessId, info: AcpExitInfo): AgentEvent[] {
  const detail = info.stderrTail.trim().split('\n').slice(-3).join(' · ');
  return [
    {
      type: 'prompt_error',
      errorMessage: detail || `The ${harness} agent exited (code ${info.code ?? 'signal'})`,
    },
    { type: 'agent_end', isTerminal: true },
  ];
}
