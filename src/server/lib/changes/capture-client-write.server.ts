/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A write the AGENT performed through this client (`fs/write_text_file`).
 *
 * It runs no tool of its own, so there is no `tool_execution_start`/end pair to
 * journal: the write event carries both sides, and that is the whole record. The
 * journal's start-frame snapshot never ran either, which is why the before side
 * must travel with the event — reading the file after the write would report no
 * change at all.
 */

import type { AgentEvent } from '@kabmo-labs/kabmo-omp/rpc-protocol/constants';
import type { PendingCall } from '@/server/lib/changes/capture-types';

/** The pending call a client-side write journals as. */
export function clientWriteCall(event: AgentEvent, run: { runId: string | null; runAt: number }): PendingCall {
  const target = typeof event.path === 'string' ? event.path : '';
  return {
    toolCallId: typeof event.toolCallId === 'string' ? event.toolCallId : `fs-${Bun.randomUUIDv7()}`,
    ...(run.runId !== null ? { runId: run.runId, runAt: run.runAt } : {}),
    tool: typeof event.toolName === 'string' && event.toolName ? event.toolName : 'write',
    agent: 'Main',
    startedAt: Date.now(),
    args: { path: target },
    before: new Map(),
    ready: Promise.resolve(),
  };
}

/** Both sides of the write, as the journal records them. */
export function clientWriteSides(event: AgentEvent): { before: string | null; after: string | null } {
  return {
    before: typeof event.before === 'string' ? event.before : null,
    after: typeof event.after === 'string' ? event.after : null,
  };
}

/** Whether the event names a path at all. */
export function clientWriteTarget(event: AgentEvent): string {
  return typeof event.path === 'string' ? event.path : '';
}
