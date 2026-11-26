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
import { AcpTranscriptRecorder } from '@/server/lib/harness/acp/session-transcript.server';
import { AcpFrameRecorder } from '@/server/lib/harness/acp/acp-frames.server';
import { claimPrewarmedAcpSession } from '@/server/lib/harness/acp/prewarm.server';
import { rememberAgentToken } from '@/server/lib/sessions/agent-token.server';
import { loadHarnessConfig } from '@/server/lib/harness/config.server';
import { resolveAccountLaunch, selectedAccountId } from '@/server/lib/harness/accounts.server';
import { accountAdapter } from '@kabmo-labs/kabmo-harness-accounts';
import { sessionLaunchCommand } from '@kabmo-labs/kabmo-harness-launch/launch';
import { resolveDefaultModel, modelProvider } from '@kabmo-labs/kabmo-harness-config';
import { harnessProbeModels } from '@/server/lib/harness/probe-cache.server';
import { claimHarness } from '@kabmo-labs/kabmo-harness-registry';
import { registerAcpSession } from '@/server/lib/harness/register.server';
import { loadHarnessSessionTitle, saveHarnessSession } from '@/server/lib/harness/session-store.server';
import { noteHarnessLease, removeHarnessLease } from '@kabmo-labs/kabmo-harness-lease/session-lease.server';
import { emitRealtimeSignal } from '@/server/lib/realtime/signals.server';
import { harnessDescriptor, type HarnessId } from '@kabmo-labs/kabmo-harness-catalog';
import { mcpDelivery } from '@kabmo-labs/kabmo-harness-mcp-facts';
import { mcpServersFor, toAcpMcpServers } from '@/server/lib/mcp/registry.server';
import { resolveMcpDefinition } from '@/server/lib/mcp/secrets.server';
import { readSessionMcpOverrides } from '@/server/lib/mcp/session-state.server';
import { ensureCustomHarnesses } from '@/server/lib/harness/custom.server';
import type { HarnessConfig } from '@kabmo-labs/kabmo-harness-config';
import type { AcpProcess } from '@kabmo-labs/kabmo-acp-client/client';
import type { HarnessSession } from '@kabmo-labs/kabmo-harness-contract';
import type { AgentEvent } from '@/server/lib/omp/rpc/constants';
import type { SelectedModel } from '@kabmo-labs/kabmo-model-contracts/models';
import type { ApprovalMode } from '@kabmo-labs/kabmo-omp-access-mode';

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
  /** Restore retained history as frames; see `AcpSessionOptions.replay`. */
  replay?: boolean;
  /** Extra environment for this child only (the agent token and server URL). */
  env?: Record<string, string>;
  /**
   * Saved account to launch. Undefined selects the harness's active account;
   * null means the host login, which is what a pre-account chat resumes on.
   */
  accountId?: string | null;
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
): Promise<{ session: AcpSession; realSessionId: string; accountId: string | null }> {
  // The USER's launch line, merged over the build's table. A command override is
  // the only way to start an agent installed outside PATH, and an env override is
  // the only provider switch an ACP agent actually honours — Kabmo routes nothing
  // model-side for these agents, so pretending to would be a wrong setting.
  // A user-added harness lives in the database, and `resolveLaunch` is
  // synchronous: load the registry before asking it for a launch line.
  await ensureCustomHarnesses();
  const configured = await loadHarnessConfig(request.harness);
  const accountId = accountAdapter(request.harness)
    ? request.accountId === undefined
      ? await selectedAccountId(request.harness)
      : request.accountId
    : null;
  let launch;
  try {
    launch = await resolveAccountLaunch(request.harness, configured, accountId);
  } catch (cause) {
    throw new HarnessNotLaunchableError(
      request.harness,
      cause instanceof Error ? cause.message : 'no launch command is configured',
    );
  }

  const picks = await resolvePicks(request, configured);
  // The MCP list is read per SPAWN, not cached: a server added in Settings must
  // reach the next chat without a restart. A harness whose delivery is a file
  // (omp's RPC mode) is not an ACP session, so this branch is the ACP contract.
  // The session's own overrides are applied here, which is what makes a toggle
  // per-session: the list is an argument to `session/new|load`, not a file.
  const overrides = await readSessionMcpOverrides(request.sessionId);
  // `!command` and bare-env values are omp's own indirection; an ACP agent
  // receives the list as JSON and would get the literal string. Resolve them
  // here, before the wire shape, so the agent gets the header omp would have
  // sent — and so the navbar's probe answers for the same server.
  const definitions = mcpDelivery(request.harness) === 'acp'
    ? await Promise.all(
        (await mcpServersFor(request.cwd, { overrides })).map((definition) =>
          resolveMcpDefinition(definition, request.cwd),
        ),
      )
    : [];
  const mcpServers = toAcpMcpServers(definitions);
  // Built here rather than behind a factory in the session module: this is the
  // only place a session is constructed, and the handshake it runs (load vs
  // new) is decided by the request this function already holds.
  const childEnv = { ...(launch.env ?? {}), ...(request.env ?? {}) };
  const session = new AcpSession(
    {
      harness: request.harness,
      command: sessionLaunchCommand(request.harness, launch.command),
      ...(Object.keys(childEnv).length > 0 ? { env: childEnv } : {}),
      ...(launch.stripEnv ? { envDrop: launch.stripEnv } : {}),
      ...(request.process ? { process: request.process } : {}),
      model: picks.model,
      thinkingLevel: picks.thinking,
      mode: picks.mode,
      accessMode: request.accessMode ?? null,
      mcpServers,
      ...(request.replay ? { replay: true } : {}),
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
  return { session, realSessionId, accountId };
}

/** The frames a restore replayed, and only from an ACP session. */
export function takeAcpReplayEvents(session: HarnessSession): AgentEvent[] {
  return session instanceof AcpSession ? session.replay.take() : [];
}

export async function startAcpSession(
  request: AcpSpawnRequest,
): Promise<{ session: HarnessSession; realSessionId: string; adopted: boolean }> {
  const accountId = accountAdapter(request.harness)
    ? request.accountId === undefined
      ? await selectedAccountId(request.harness)
      : request.accountId
    : null;
  const claimable = request.claimPrewarmed && !request.resumeAgentSessionId && !request.forkAgentSessionId;
  // A warm agent skips the spawn AND the `initialize` handshake; `session/new`
  // and the picks still run, in the same place a cold spawn runs them, so there
  // is one definition of "the session a chat starts in".
  const warm = claimable
    ? await claimPrewarmedAcpSession(request.harness, request.cwd, accountId ?? '')
    : null;
  const { session, realSessionId } = await openAcpSession(
    warm ? { ...request, accountId, process: warm.process } : { ...request, accountId },
  );
  // The transcript this session writes for itself. A restore replays the
  // agent's history and persists it itself, so it is the one session that must
  // not record. The listener is attached before the first prompt, which is what
  // makes a server-spawned child's timeline non-empty.
  const recorder = request.replay ? null : new AcpTranscriptRecorder(() => realSessionId);
  if (recorder) {
    await recorder.hydrate();
    session.onEvent((event) => recorder.record(event));
  }
  // The raw panel reads the original `session/update` payloads, not the fold
  // above. A restore replays the agent's history and must not duplicate it.
  const frameRecorder = request.replay ? null : new AcpFrameRecorder(() => realSessionId);
  if (frameRecorder) session.onRawNotification((method, params) => frameRecorder.record(method, params));
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
  registerAcpSession(session, request.sessionId, () => {
    if (pid) removeHarnessLease(pid);
    recorder?.dispose();
    frameRecorder?.dispose();
  });
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
    accountId: accountId ?? '',
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
