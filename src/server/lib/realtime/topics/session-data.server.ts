/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The per-session DATA topics: todos, plan, telemetry and the follow-up queue.
 *
 * Each is a read-only projection the server can produce from disk or the
 * database, so their snapshots are plain resolver calls and their deltas are
 * published by whoever changes the underlying data. None of them spawns an omp
 * child (see the plan's server-side invariants).
 */

import {
  sessionPlanTopic,
  sessionQueueTopic,
  sessionTelemetryTopic,
  sessionTodosTopic,
} from '@/shared/lib/realtime/protocol';
import { type TopicDescriptor } from '@/server/lib/realtime/hub.server';
import { readSessionTodos } from '@/server/lib/omp/session/todos';
import { readSessionPlans } from '@/server/lib/omp/session/plans';
import { mockSessionTodos, mockSessionPlans } from '@/server/lib/omp/session/data-mock';
import { listQueue } from '@/server/lib/queue/store.server';
import { loadSessionSource } from '@/server/lib/chat/session-store.server';
import { computeRealSessionTelemetry } from '@/server/lib/omp/session/telemetry';
import { isMockMode } from '@/server/mock.server';
import type { SessionTodosPayload } from '@/shared/types/todo';
import type { SessionPlanPayload } from '@/shared/types/plan';

/**
 * One session's todo snapshot, as the panel renders it.
 *
 * The payload carries `sessionId` / `generatedAt` / `isMock` as well as the
 * state, because the panel reads the Mock badge off it — a resolver that
 * answered the bare state would leave the badge permanently absent.
 */
function todosDescriptor(sessionId: string): TopicDescriptor {
  return {
    resolve: async (): Promise<SessionTodosPayload> => {
      const isMock = isMockMode();
      return {
        sessionId,
        ...(isMock ? mockSessionTodos() : await readSessionTodos(sessionId)),
        generatedAt: new Date().toISOString(),
        isMock,
      };
    },
  };
}

/** One session's plan artifacts, plus the chosen plan's body. */
function planDescriptor(sessionId: string): TopicDescriptor {
  return {
    resolve: async (): Promise<SessionPlanPayload> => {
      const isMock = isMockMode();
      return {
        sessionId,
        ...(isMock ? mockSessionPlans() : await readSessionPlans(sessionId)),
        generatedAt: new Date().toISOString(),
        isMock,
      };
    },
  };
}

/** One session's follow-up queue, in delivery order. */
function queueDescriptor(sessionId: string): TopicDescriptor {
  return { resolve: () => listQueue(sessionId) };
}

/**
 * One session's context telemetry.
 *
 * The panel's summary only — raw message items stay behind their own paged
 * request, so this payload stays light even for a very long session.
 */
function telemetryDescriptor(sessionId: string): TopicDescriptor {
  return {
    resolve: async () => {
      if (isMockMode()) return null;
      const source = await loadSessionSource(sessionId);
      // The real computation reads the session's JSONL; the in-memory source
      // has no file to point at, so those sessions answer nothing here and the
      // panel's own HTTP read covers them.
      if (source?.kind !== 'jsonl') return null;
      return computeRealSessionTelemetry(source.filePath, sessionId);
    },
  };
}

export const SESSION_DATA_TOPICS: Record<string, (sessionId: string) => TopicDescriptor> = {
  [sessionTodosTopic('')]: todosDescriptor,
  [sessionPlanTopic('')]: planDescriptor,
  [sessionTelemetryTopic('')]: telemetryDescriptor,
  [sessionQueueTopic('')]: queueDescriptor,
};
