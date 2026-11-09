/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Spawn an ACP-backed session and register it exactly like an omp one.
 *
 * The registration rules are omp's, reused rather than reimplemented: a session
 * lands in the shared registry under BOTH the id the caller asked for and the id
 * the agent reported, because the id can change (a load that forks) and the
 * client keeps posting to the id it holds. `registerSpawnedSession` owns that
 * rule; this module only supplies the driver.
 *
 * The model/thinking/mode picks ride the CONFIG WRITES after `session/new` — not
 * an environment variable — because ACP publishes them as selectors and the
 * agent applies them to the session it just created.
 */

import { AcpSession } from '@/server/lib/harness/acp/session';
import { loadHarnessConfig, resolveLaunch } from '@/server/lib/harness/config.server';
import { sessionLaunchCommand } from '@/server/lib/harness/launch';
import { resolveDefaultModel, modelProvider } from '@/shared/lib/harness/config';
import { harnessProbeModels } from '@/server/lib/harness/probe-cache.server';
import { claimHarness } from '@/server/lib/harness/registry';
import { registerAcpSession } from '@/server/lib/harness/register.server';
import { saveHarnessSession } from '@/server/lib/harness/session-store.server';
import { emitRealtimeSignal } from '@/server/lib/realtime/signals.server';
import { harnessDescriptor, type HarnessId } from '@/shared/lib/harness/catalog';
import type { HarnessSession } from '@/server/lib/harness/session';
import type { SelectedModel } from '@/shared/types/models';
import type { ApprovalMode } from '@/shared/lib/omp/config/access-mode';

export interface AcpSpawnRequest {
  harness: HarnessId;
  sessionId: string;
  /** On-disk transcript to resume; '' for a new chat. For ACP that is the
   *  agent's own session id, not a path — Kabmo stores it in `harness_sessions`. */
  resumeAgentSessionId?: string;
  /** Fork this agent session instead of starting a new one. Mutually exclusive
   *  with `resumeAgentSessionId`; the returned id is the child's own. */
  forkAgentSessionId?: string;
  cwd: string;
  model?: SelectedModel | null;
  thinkingLevel?: string | null;
  mode?: string | null;
  /** The composer's access pick, applied to the ACP session's own approval
   *  gate (this transport has no `--approval-mode` spawn flag). */
  accessMode?: ApprovalMode | null;
  /** Extra environment for this child only (the agent token and server URL). */
  env?: Record<string, string>;
}

export class HarnessNotLaunchableError extends Error {
  constructor(harness: HarnessId, reason: string) {
    super(`Cannot start ${harnessDescriptor(harness)?.label ?? harness}: ${reason}`);
    this.name = 'HarnessNotLaunchableError';
  }
}

export async function startAcpSession(
  request: AcpSpawnRequest,
): Promise<{ session: HarnessSession; realSessionId: string }> {
  // The USER's launch line, merged over the build's table. A command override is
  // the only way to start an agent installed outside PATH, and an env override is
  // the only provider switch an ACP agent actually honours — Kabmo routes nothing
  // model-side for these agents, so pretending to would be a wrong setting.
  const configured = await loadHarnessConfig(request.harness);
  let launch;
  try {
    launch = resolveLaunch(request.harness, configured);
  } catch (cause) {
    throw new HarnessNotLaunchableError(
      request.harness,
      cause instanceof Error ? cause.message : 'no launch command is configured',
    );
  }

  // The model the chat starts on: the request's pick, else the harness's own
  // configured default. Resolved against what the AGENT published, so a stale
  // default falls through rather than failing the first prompt.
  const probedModels = await harnessProbeModels(request.harness);
  const configuredDefault = resolveDefaultModel(configured, probedModels);
  const startingModel = request.model
    ?? (configuredDefault ? { provider: modelProvider(configuredDefault), modelId: configuredDefault } : null);

  // Built here rather than behind a factory in the session module: this is the
  // only place a session is constructed, and the handshake it runs (load vs
  // new) is decided by the request this function already holds.
  const childEnv = { ...(launch.env ?? {}), ...(request.env ?? {}) };
  const session = new AcpSession(
    {
      harness: request.harness,
      command: sessionLaunchCommand(request.harness, launch.command),
      ...(Object.keys(childEnv).length > 0 ? { env: childEnv } : {}),
      model: startingModel,
      thinkingLevel: request.thinkingLevel ?? configured.thinking ?? null,
      mode: request.mode ?? configured.mode ?? null,
      accessMode: request.accessMode ?? null,
    },
    request.cwd,
  );
  let realSessionId: string;
  try {
    ({ sessionId: realSessionId } = await session.start(
      request.resumeAgentSessionId || undefined,
      request.forkAgentSessionId,
    ));
  } catch (error) {
    // A refused handshake (an agent that will not `session/load`, a launch line
    // that cannot run) must not leave the child it just spawned running with
    // nobody holding it: measured on a resume of a chat the agent no longer
    // knew, the process stayed alive after the request answered an error.
    await session.destroyAndWait().catch(() => {});
    throw error;
  }
  if (!realSessionId) {
    await session.destroyAndWait().catch(() => {});
    throw new Error(`${request.harness} started a session without an id`);
  }

  claimHarness(session, request.harness);
  registerAcpSession(session, request.sessionId);
  // Record the ownership BEFORE the first frame is forwarded: the sidebar reads
  // this table, not the live registry, so a row written late would draw the row
  // as `omp` until the next folder load. A failed write must not kill a live
  // session, but it must be visible — silently losing it restores the bug this
  // table exists to fix.
  await saveHarnessSession({
    sessionId: realSessionId,
    harness: request.harness,
    agentSessionId: realSessionId === request.sessionId ? '' : realSessionId,
    cwd: request.cwd,
  }).catch((cause: unknown) => {
    console.error(`[harness] could not record ${request.harness} for session ${realSessionId}:`, cause);
  });
  // `request.sessionId` is the CLIENT's placeholder (`__new__<uuid>`) for a chat
  // that had no id yet. It is an alias in the live registry, never a session:
  // persisting it listed the same chat twice in the sidebar, once under an id
  // that stops existing the moment the tab adopts the real one.
  // A subscriber that attached before the spawn holds a `running:false`
  // snapshot; the child exists now, so the topic must re-snapshot.
  emitRealtimeSignal('session-attached', realSessionId);
  if (request.sessionId !== realSessionId) emitRealtimeSignal('session-attached', request.sessionId);
  return { session, realSessionId };
}
