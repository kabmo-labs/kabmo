/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Wake a session that is not running, so a queued system notice can be
 * delivered to it.
 *
 * The existing queue dispatcher assumes a LIVE session (`QueueDeliveryHost`):
 * `waiting/runtime.server.ts` is the other cold path, and it only knows how to
 * spawn a fresh omp child. A parent that finished an hour ago is neither live
 * nor fresh, so the notice would sit in `queued_messages` until the user opened
 * the tab — which defeats the point of a manager session.
 *
 * The deps are injectable so the branch logic (file → RPC, recorded ACP →
 * `session/load`, unresolvable → null) is testable without spawning an agent.
 */

import { getLiveSession, startRpcSession } from '@/server/lib/omp/rpc/session-registry';
import { findSessionFileById } from '@/server/lib/omp/session/locator';
import { startAcpSession } from '@/server/lib/harness/spawn.server';
import { repointHarnessSession } from '@kabmo-labs/kabmo-harness-session/session-store.server';
import { loadPersistedAccessMode } from '@/shared/lib/omp/config/access-mode.server';
import { loadStreamStates } from '@kabmo-labs/kabmo-session-stream-state';
import { emitRealtimeSignal } from '@kabmo-labs/kabmo-realtime-signals';
import type { QueueDeliveryHost } from '@/server/lib/queue/delivery.server';
import { resolveSessionRef } from '@/server/lib/sessions/resolve.server';
import { mintAgentEnvironment, rememberAgentToken } from '@/server/lib/sessions/agent-token.server';
import type { HarnessId } from '@kabmo-labs/kabmo-harness-catalog';

export interface DispatchDeps {
  findFile(sessionId: string): Promise<string | undefined>;
  startOmp(sessionId: string, file: string, cwd: string): Promise<QueueDeliveryHost>;
  startAcp(
    sessionId: string,
    harness: HarnessId,
    cwd: string,
    agentSessionId: string,
    accountId: string,
  ): Promise<QueueDeliveryHost>;
}

async function startOmp(sessionId: string, file: string, cwd: string): Promise<QueueDeliveryHost> {
  const accessMode = await loadPersistedAccessMode();
  const states = await loadStreamStates();
  const model = states[sessionId]?.model ?? null;
  const { token, env } = mintAgentEnvironment();
  const { session } = await startRpcSession(
    sessionId,
    file,
    cwd,
    cwd,
    accessMode,
    env,
    model ?? undefined,
  );
  await rememberAgentToken(sessionId, token).catch((cause: unknown) => {
    console.error(`[sessions] could not record the agent token for ${sessionId}:`, cause);
  });
  return session;
}

async function startAcp(
  sessionId: string,
  harness: HarnessId,
  cwd: string,
  agentSessionId: string,
  accountId: string,
): Promise<QueueDeliveryHost> {
  const accessMode = await loadPersistedAccessMode();
  const { token, env } = mintAgentEnvironment();
  const { session, realSessionId } = await startAcpSession({
    harness,
    sessionId,
    resumeAgentSessionId: agentSessionId || sessionId,
    cwd,
    accountId: accountId || null,
    accessMode,
    env,
  });
  await rememberAgentToken(sessionId, token).catch((cause: unknown) => {
    console.error(`[sessions] could not record the agent token for ${sessionId}:`, cause);
  });
  // A load that forks answers a new agent id. The session keeps ITS id (the
  // URL and the relation name it), and the record adopts the agent's — the same
  // rule `resumeRecordedHarnessSession` applies.
  if (realSessionId !== sessionId) {
    await repointHarnessSession(sessionId, realSessionId).catch(() => {});
    emitRealtimeSignal('sidebar-structure');
  }
  return session;
}

const defaultDeps: DispatchDeps = {
  findFile: findSessionFileById,
  startOmp,
  startAcp,
};

/**
 * A live session for this id, resuming it when necessary.
 *
 * File-backed sessions resume over RPC even when their recorded harness is
 * `omp-acp`: omp writes the transcript, and `session/load` on omp forks — which
 * would create a second id for the same chat. ACP-only sessions use
 * `session/load`. Anything unresolvable returns null and the caller reports it.
 */
export async function ensureSessionLive(
  sessionId: string,
  deps: DispatchDeps = defaultDeps,
): Promise<QueueDeliveryHost | null> {
  const live = getLiveSession(sessionId);
  if (live?.isAlive()) return live;

  const ref = await resolveSessionRef(sessionId);
  if (!ref.cwd) return null;

  try {
    const file = await deps.findFile(sessionId);
    if (file) return await deps.startOmp(sessionId, file, ref.cwd);
    if (!ref.harness || ref.harness === 'omp-rpc') return null;
    return await deps.startAcp(sessionId, ref.harness, ref.cwd, ref.agentSessionId, ref.accountId);
  } catch (error) {
    console.error(
      `[sessions] could not resume ${sessionId}:`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}
