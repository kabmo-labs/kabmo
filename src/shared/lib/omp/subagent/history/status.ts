/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Status projection shared by the subagent history fold and settlement pass.
 *
 * omp reports lifecycle state in several shapes — live progress snapshots,
 * settled task SingleResults, async-result job snapshots — and all of them map
 * onto the roster's terminal status vocabulary here, together with the guard
 * that stops a stale progress snapshot from regressing a settled agent.
 */

import type { SubagentHistoryEntry } from '@/shared/types/omp/subagent';

export function progressStatusToHistory(status: string | undefined): SubagentHistoryEntry['status'] {
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  if (status === 'aborted') return 'aborted';
  return 'started';
}

export function resultStatus(value: Record<string, unknown>): SubagentHistoryEntry['status'] {
  const explicit = value.status;
  if (explicit === 'completed' || explicit === 'failed' || explicit === 'aborted') return explicit;
  if (value.aborted === true) return 'aborted';
  if (typeof value.error === 'string' && value.error) return 'failed';
  if (typeof value.exitCode === 'number') return value.exitCode === 0 ? 'completed' : 'failed';
  return 'started';
}

/** True when an entry already carries a settled state that a stale/duplicate
 *  progress snapshot must not regress (unknown/running → "started"). */
export function progressUpsertBlocked(existing: SubagentHistoryEntry): boolean {
  return existing.result !== undefined
    || existing.status === 'completed'
    || existing.status === 'failed'
    || existing.status === 'aborted';
}
