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
 * The model/thinking/mode picks ride the CONFIG WRITES after `session/new` —
 * not an environment variable — because ACP publishes them as selectors and the
 * agent applies them to the session it just created. That is also what lets a
 * PREWARMED process (spawned and initialized before the picks were known) serve
 * the request: the adopting session runs the same `session/new` and the same
 * writes, minus the boot.
 */

import { AcpSession } from '@/server/lib/harness/acp/session';
import { claimPrewarmedAcpSession } from '@/server/lib/harness/acp/prewarm.server';
import { rememberAgentToken } from '@/server/lib/sessions/agent-token.server';
import { loadHarnessConfig, resolveLaunch } from '@/server/lib/harness/config.server';
import { sessionLaunchCommand } from '@/server/lib/harness/launch';
import { resolveDefaultModel, modelProvider } from '@/shared/lib/harness/config';
import { harnessProbeModels } from '@/server/lib/harness/probe-cache.server';
import { claimHarness } from '@/server/lib/harness/registry';
import { registerAcpSession } from '@/server/lib/harness/register.server';
import { loadHarnessSessionTitle, saveHarnessSession } from '@/server/lib/harness/session-store.server';
import { noteHarnessLease, removeHarnessLease } from '@/server/lib/harness/session-lease.server';
import { emitRealtimeSignal } from '@/server/lib/realtime/signals.server';
import { harnessDescriptor, type HarnessId } from '@/shared/lib/harness/catalog';
import type { HarnessConfig } from '@/shared/lib/harness/config';
import type { AcpProcess } from '@/server/lib/harness/acp/client';
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
  /** `_meta` for `session/fork` — the fork point an agent extension reads
   *  (claude-agent-acp's AIR `fork`). Omitted forks the whole session. */
  forkMeta?: Record<string, unknown>;
  cwd: string;
  model?: SelectedModel | null;
  thinkingLevel?: string | null;
  mode?: string | null;
  /** The composer's access pick, applied to the ACP session's own approval
   *  gate (this transport has no `--approval-mode` spawn flag). */
  accessMode?: ApprovalMode | null;
  /** Extra environment for this child only (the agent token and server URL). */
  env?: Record<string, string>;
  /** A prewarmed (spawned + initialized) agent to adopt instead of spawning. */
  process?: AcpProcess;
  /**
   * Adopt a prewarmed agent for this harness+cwd, when one is waiting.
   *
   * Opt-in rather than always: the prewarm belongs to the pending chat that
   * triggered it (a New Chat click or a harness pick), and a child spawn or a
   * resume must not consume it. Only a brand-new top-level chat claims.
   */
  claimPrewarmed?: boolean;
}

export class HarnessNotLaunchableError extends Error {
  constructor(harness: HarnessId, reason: string) {
    super(`${harnessDescriptor(harness)?.label ?? harness} cannot start: ${reason}`);
    this.name = 'HarnessNotLaunchableError';
  }
}

/** The model/thinking/mode a start would apply, resolved against what the agent
 *  published. Shared by the cold spawn and the claim, so a prewarmed session
 *  ends on exactly the picks a cold one would have started with. */
async function resolvePicks(
  request: AcpSpawnRequest,
  loaded?: HarnessConfig,
): Promise<{
  model: SelectedModel | null;
  thinking: string | null;
  mode: string | null;
}> {
  const configured = loaded ?? await loadHarnessConfig(request.harness);
  const probedModels = await harnessProbeModels(request.harness);
  const configuredDefault = resolveDefaultModel(configured, probedModels);
  const model = request.model
    ?? (configuredDefault ? { provider: modelProvider(configuredDefault), modelId: configuredDefault } : null);
  return {
    model,
    thinking: request.thinkingLevel ?? configured.thinking ?? null,
    mode: request.mode ?? configured.mode ?? null,
  };
}

export async function openAcpSession(
  request: AcpSpawnRequest,
): Promise<{ session: AcpSession; realSessionId: string }> {
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

  const picks = await resolvePicks(request, configured);
  // Built here rather than behind a factory in the session module: this is the
  // only place a session is constructed, and the handshake it runs (load vs
  // new) is decided by the request this function already holds.
  const childEnv = { ...(launch.env ?? {}), ...(request.env ?? {}) };
  const session = new AcpSession(
    {
      harness: request.harness,
      command: sessionLaunchCommand(request.harness, launch.command),
      ...(Object.keys(childEnv).length > 0 ? { env: childEnv } : {}),
      ...(request.process ? { process: request.process } : {}),
      model: picks.model,
      thinkingLevel: picks.thinking,
      mode: picks.mode,
      accessMode: request.accessMode ?? null,
    },
    request.cwd,
  );
  // The lease is written BEFORE the handshake: the Stats panel samples once a
  // second, and a child that exists but has no lease is drawn as a bare `npx`
  // row inside Kabmo's own group. `startedAt` is therefore the spawn time, not
  // the (possibly 80 s) handshake's end.
  const pid = session.pid;
  if (pid) noteHarnessLease({ pid, harness: request.harness, cwd: request.cwd, state: 'starting' });
  let realSessionId: string;
  try {
    ({ sessionId: realSessionId } = await session.start(
      request.resumeAgentSessionId || undefined,
      request.forkAgentSessionId,
      request.forkMeta,
    ));
  } catch (error) {
    // A refused handshake (an agent that will not `session/load`, a launch line
    // that cannot run) must not leave the child it just spawned running with
    // nobody holding it: measured on a resume of a chat the agent no longer
    // knew, the process stayed alive after the request answered an error.
    if (pid) removeHarnessLease(pid);
    await session.destroyAndWait().catch(() => {});
    throw error;
  }
  if (!realSessionId) {
    if (pid) removeHarnessLease(pid);
    await session.destroyAndWait().catch(() => {});
    throw new Error(`${request.harness} started a session without an id`);
  }
  if (pid) {
    // A resumed chat already has a name in `harness_sessions`; the panel must
    // show it on the first sample rather than `session <short>` until the next
    // prompt. A new chat has no row yet, so the read answers ''.
    const title = await loadHarnessSessionTitle(realSessionId).catch(() => '');
    noteHarnessLease({
      pid,
      harness: request.harness,
      cwd: request.cwd,
      state: 'session',
      sessionId: realSessionId,
      title,
    });
  }
  return { session, realSessionId };
}

export async function startAcpSession(
  request: AcpSpawnRequest,
): Promise<{ session: HarnessSession; realSessionId: string; adopted: boolean }> {
  const claimable = request.claimPrewarmed && !request.resumeAgentSessionId && !request.forkAgentSessionId;
  // A warm agent skips the spawn AND the `initialize` handshake; `session/new`
  // and the picks still run, in the same place a cold spawn runs them, so there
  // is one definition of "the session a chat starts in".
  const warm = claimable ? await claimPrewarmedAcpSession(request.harness, request.cwd) : null;
  const { session, realSessionId } = await openAcpSession(
    warm ? { ...request, process: warm.process } : request,
  );
  if (warm) {
    // The process's environment already carries the credential minted at
    // prewarm; recording a different one here would authenticate its callbacks
    // against a token nobody holds.
    await rememberAgentToken(realSessionId, warm.token).catch((cause: unknown) => {
      console.error(`[harness] could not record the agent token for ${realSessionId}:`, cause);
    });
  }

  claimHarness(session, request.harness);
  // The lease is removed by the SAME destroy hook that unregisters the session:
  // `onDestroy` is a single slot, so a second registration would silently
  // replace the registry cleanup and leave a dead session answering for its id.
  const pid = session.pid;
  registerAcpSession(session, request.sessionId, pid ? () => removeHarnessLease(pid) : undefined);
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
  // `adopted` is what tells the route NOT to record its own callback token: the
  // claimed child's environment already carries the one minted when it warmed,
  // and replacing it made every callback from that agent fail authentication.
  return { session, realSessionId, adopted: warm !== null };
}
