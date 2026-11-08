/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Todos panel for an ACP chat.
 *
 * ACP's `plan` update is the agent's own task list — the same idea omp stores in
 * a `todo` tool result, which the panel reads from a transcript this transport
 * does not write. Mapping it here means the same panel renders both transports
 * instead of saying "the agent never used todos" over a full plan.
 *
 * The spec's entries carry `content` + `status`; priority and unknown statuses
 * are ignored rather than guessed.
 */

import type { SessionTodoState, TodoItem, TodoPhase, TodoStatus } from '@/shared/types/todo';
import { todoProgress } from '@/shared/lib/chat/todo/snapshot';

function statusOf(value: unknown): TodoStatus {
  return value === 'completed' || value === 'in_progress' || value === 'pending' ? value : 'pending';
}

/** Map the agent's plan entries into the payload the Todos panel consumes. */
export function buildAcpTodos(entries: readonly unknown[]): SessionTodoState {
  const tasks: TodoItem[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.content !== 'string' || !record.content.trim()) continue;
    tasks.push({ content: record.content, status: statusOf(record.status) });
  }
  if (tasks.length === 0) return { snapshot: null, progress: todoProgress([]) };
  const phases: TodoPhase[] = [{ name: 'Plan', tasks }];
  return {
    snapshot: {
      phases,
      sourceEntryId: 'acp-plan',
      source: 'custom',
      updatedAt: new Date().toISOString(),
    },
    progress: todoProgress(phases),
  };
}
