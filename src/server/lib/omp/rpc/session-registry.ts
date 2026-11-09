/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Global omp session registry: keeps one AgentSessionWrapper per session id and
 * exposes lookups. Split out of rpc-manager.ts so each file stays under the
 * repo's per-file size ceiling. Importing AgentSessionWrapper here is a
 * runtime-only circular reference with rpc-manager — every usage happens inside
 * a function, never at module init.
 */

import { RpcProcess } from '@/server/lib/omp/rpc/process';
import { buildSessionSpawnArgs } from '@/server/lib/omp/rpc/constants';
import { AgentSessionWrapper } from '@/server/lib/omp/rpc/manager';
import { syncDiscoveryRootsWatch } from '@/server/lib/omp/config/roots-watch.server';
import { emitRealtimeSignal } from '@/server/lib/realtime/signals.server';
import { localRuns } from '@/server/lib/omp/session/local-runs.server';
import { recordSpawnProvenance } from '@/server/lib/omp/rpc/spawn-provenance';
import { registerSpawnedSession } from '@/server/lib/omp/rpc/session-registration';
import { resolveSessionOwnership, SessionOwnedElsewhereError } from '@/server/lib/omp/session/ownership.server';
import { claimPrewarmedSession } from '@/server/lib/omp/rpc/prewarm-pool';
import { mintAgentEnvironment, rememberAgentToken } from '@/server/lib/sessions/agent-token.server';
import { isUnrestorableModelFailure, resolveResumableModel } from '@/server/lib/omp/session/resumable-model.server';
import { DEFAULT_APPROVAL_MODE, type ApprovalMode } from '@/shared/lib/omp/config/access-mode';
import type { SelectedModel } from '@/shared/types/models';
import { claimHarness, harnessOf } from '@/server/lib/harness/registry';
import { saveHarnessSession } from '@/server/lib/harness/session-store.server';
import type { HarnessId } from '@/shared/lib/harness/catalog';
import type { HarnessSession } from '@/server/lib/harness/session';

/**
 * A session this process is running: omp over RPC, or any ACP agent.
 *
 * The union lives in the REGISTRY rather than behind two maps because every
 * consumer asks the same questions — is it alive, is a run in flight, which
 * dialogs are pending — and two registries would answer "is this session live"
 * twice. Members that only omp has (`runSettle`, `modeMirror`, `reloadPlugins`)
 * are reached through `asOmpSession`, which returns undefined for anything else
 * so a missing panel is a stated gap rather than a crash.
 */
export type LiveSession = AgentSessionWrapper | HarnessSession;

/**
 * The omp view of a live session, or undefined when another harness owns it.
 *
 * Decided by the OWNERSHIP record, not by `instanceof` or by sniffing fields:
 * a driver claims its sessions once at spawn (`claimHarness`), and everything
 * that is not claimed is omp's — which is the truth for every session that
 * predates harnesses, for a `bun --hot` reload, and for a test's own fake
 * wrapper. Field sniffing classified those fakes as "another harness" and sent
 * live omp chats down the harness-agnostic path.
 */
export function asOmpSession(session: LiveSession | undefined): AgentSessionWrapper | undefined {
  if (!session) return undefined;
  return harnessOf(session) === 'omp-rpc' ? (session as AgentSessionWrapper) : undefined;
}

/** Which harness runs a session. */
export function harnessOfSession(session: LiveSession): HarnessId {
  return harnessOf(session);
}

export { getSpawnApprovalMode, getSpawnModeEnv, reconcileSpawnApprovalMode } from '@/server/lib/omp/rpc/spawn-provenance';

declare global {
  // eslint-disable-next-line no-var
  var __ompSessions: Map<string, LiveSession> | undefined;
  // eslint-disable-next-line no-var
  var __ompStartLocks: Map<string, Promise<{ session: AgentSessionWrapper; realSessionId: string }>> | undefined;
}

function getRegistry(): Map<string, LiveSession> {
  if (!globalThis.__ompSessions) {
    globalThis.__ompSessions = new Map();
    const cleanup = () => globalThis.__ompSessions?.forEach((s) => s.destroy());
    process.once('exit', cleanup);
    process.once('SIGINT', cleanup);
    process.once('SIGTERM', cleanup);
  }
  return globalThis.__ompSessions;
}

function getLocks(): Map<string, Promise<{ session: AgentSessionWrapper; realSessionId: string }>> {
  if (!globalThis.__ompStartLocks) globalThis.__ompStartLocks = new Map();
  return globalThis.__ompStartLocks;
}

/** The OMP view of a session, or undefined when another harness owns it.
 *
 *  Kept as the narrow accessor on purpose: fourteen call sites read omp-only
 *  members (`runSettle`, `modeMirror`, `reloadPlugins`, the spawn flags), and
 *  widening this would make each of them answer a question about a driver it
 *  does not have. `getLiveSession` is the harness-agnostic lookup. */
export function getRpcSession(sessionId: string): AgentSessionWrapper | undefined {
  return asOmpSession(getRegistry().get(sessionId));
}

/** Any live session, whichever harness runs it. */
export function getLiveSession(sessionId: string): LiveSession | undefined {
  return getRegistry().get(sessionId);
}

/** Every live OMP session. */
export function listRpcSessions(): AgentSessionWrapper[] {
  return [...getRegistry().values()]
    .map((session) => asOmpSession(session))
    .filter((session): session is AgentSessionWrapper => Boolean(session?.isAlive()));
}

/** Every live session, any harness — for operations that must reach all of them
 *  (a plugin/skill reload, a sidebar status sweep) rather than one addressed id. */
export function listLiveSessions(): LiveSession[] {
  return [...getRegistry().values()].filter((session) => session.isAlive());
}

/**
 * Sessions whose omp process is parked on a dialog only the user can release —
 * an `ask` question or an approval gate. Deliberately independent of
 * `isRunning()`: a blocked dialog leaves every turn flag exactly as it was, so
 * the pending-dialog registry is the only thing that can tell a session waiting
 * for an answer from an idle one. Feeds the sidebar's "needs input" badge, which
 * has to reach clients that never opened the session.
 */
export function getAwaitingInputSessionIds(): string[] {
  const ids = new Set<string>();
  for (const [sessionId, session] of getRegistry()) {
    if (session.isAlive() && session.getPendingUiDialogs().length > 0) {
      ids.add(session.sessionId || sessionId);
    }
  }
  return [...ids];
}

/**
 * Sessions this process is running RIGHT NOW — the ones whose `stream` row is
 * genuinely live.
 *
 * Deliberately the reader's OWN registry, unlike the staleness rule, which is
 * judged from the row's `owner_pid` and OS liveness so every instance agrees:
 * `isStaleStreamRow` asks "did the writer die?" (answerable from the row alone),
 * while this asks "does THIS process still hold a run?" — which only this
 * process can answer, and which is the only thing that can release a row whose
 * owner is alive but whose run is gone (a dropped prompt, a lost `agent_end`).
 *
 * `isRunning()` is the same predicate `GET /api/agent/:id` reports as `busy`,
 * so the sidebar's spinner and the attach probe cannot disagree.
 */
export function getLiveRunSessionIds(): Set<string> {
  // Starts from the LOCAL runs: a simulated stream (MOCK mode) is a run this
  // process drives with no omp child behind it, so the loop below cannot see it
  // and the self-heal would read its row as an orphan. See `local-runs.server`.
  const ids = new Set(localRuns());
  for (const [sessionId, session] of getRegistry()) {
    if (session.isAlive() && session.isRunning()) ids.add(session.sessionId || sessionId);
  }
  return ids;
}

/**
 * Get or create the omp RPC process for the given session.
 * For new sessions (sessionFile === ''), omp generates its own id.
 */
export async function startRpcSession(
  sessionId: string,
  sessionFile: string,
  cwd: string,
  recordedCwd?: string | null,
  approvalMode?: ApprovalMode,
  modeEnv?: Record<string, string>,
  resumeModel?: SelectedModel,
): Promise<{ session: AgentSessionWrapper; realSessionId: string }> {
  const registry = getRegistry();
  const locks = getLocks();

  // This function only ever SPAWNS omp sessions, so a live session under the
  // same id that belongs to another harness is a collision the caller must
  // resolve — adopting it here would hand back the wrong transport.
  const existing = asOmpSession(registry.get(sessionId));
  if (existing?.isAlive()) {
    // The child's OWN id, not the one asked for: after a forked resume the two
    // differ, and `realSessionId` means the former. Callers that persist it (the
    // scheduler) must not record the alias as if it were the session.
    return { session: existing, realSessionId: existing.sessionId || sessionId };
  }
  if (existing?.destroyPromise) await existing.destroyPromise;

  // A session file another omp process already owns must not be resumed: omp
  // would move THIS child to a sibling file (open-elsewhere), splitting the
  // conversation and adding a duplicate sidebar row with the same title. The
  // local registry above cannot see a second Kabmo instances, so ownership is
  // read from omp's own lease (see ownership.server.ts).
  if (sessionFile) {
    const ownership = await resolveSessionOwnership(sessionId);
    if (ownership) throw new SessionOwnedElsewhereError(sessionId, ownership);
  }

  const inflight = locks.get(sessionId);
  if (inflight) return inflight;

  const starting = spawnOnce(sessionId, sessionFile, cwd, recordedCwd, approvalMode, modeEnv)
    .catch(async (error) => {
      // omp restores the model the session's transcript records, and it does
      // NOT fall back when that model is gone: the child exits(1) with
      // "Could not restore model <provider>/<id>" and EVERY command to the
      // session fails with it. Measured on omp 18.13.1 — a session whose last
      // model_change named a provider that is no longer in the registry could
      // not receive a prompt at all.
      //
      // The recovery respawns it with a model omp CAN resolve. The command
      // that triggered this spawn then runs against the new child, so the
      // user's own `set_model` still lands on it.
      //
      // The first attempt is deliberately left UNCHANGED (no `--model`): a
      // caller's pick can itself be stale — the picker's list is a 60 s
      // snapshot — and naming it up front made a healthy session unopenable
      // ("Model <x> not found"). It is only a CANDIDATE here, and one that has
      // to survive the resolvability check.
      if (!isUnrestorableModelFailure(error)) throw error;
      const replacement = await resolveResumableModel(resumeModel);
      if (!replacement) throw error;
      return spawnOnce(sessionId, sessionFile, cwd, recordedCwd, approvalMode, modeEnv, replacement);
    })
    .finally(() => locks.delete(sessionId));

  locks.set(sessionId, starting);
  return starting;
}

/** One spawn attempt: build the child, wait for it to be ready, register it. */
async function spawnOnce(
  sessionId: string,
  sessionFile: string,
  cwd: string,
  recordedCwd: string | null | undefined,
  approvalMode: ApprovalMode | undefined,
  modeEnv: Record<string, string> | undefined,
  resumeModel?: SelectedModel | undefined,
): Promise<{ session: AgentSessionWrapper; realSessionId: string }> {
  const registry = getRegistry();
  const holder: { wrapper?: AgentSessionWrapper } = {};
  const proc = new RpcProcess({
    cwd,
    extraArgs: buildSessionSpawnArgs(sessionFile, approvalMode, resumeModel),
    env: modeEnv,
    onExit: ({ stderrTail }) => holder.wrapper?.handleProcessExit(stderrTail),
  });
  const created = new AgentSessionWrapper(proc, cwd, recordedCwd);
  recordSpawnProvenance(created, approvalMode, modeEnv);
  holder.wrapper = created;
  created.start();
  try {
    await created.waitUntilReady();
  } catch (error) {
    await created.destroyAndWait();
    throw error;
  }

  const realSessionId = created.sessionId;
  registerSpawnedSession(registry, created, sessionId, realSessionId);
  claimHarness(created, 'omp-rpc');
  // Persist the ownership too, so the sidebar's mark does not depend on the
  // fallback: a row is only `omp` by DEFAULT because nothing wrote the row, and
  // a default is a guess where a record is a fact.
  void saveHarnessSession({
    sessionId: realSessionId,
    harness: 'omp-rpc',
    agentSessionId: '',
    cwd,
  }).catch((cause: unknown) => {
    console.error(`[harness] could not record omp-rpc for session ${realSessionId}:`, cause);
  });
  // A session's cwd may sit outside every registered workspace, and omp
  // resolves project skills from it all the same — so the discovery watcher
  // has to learn this directory. AWAITED, not fired and forgotten: the
  // reconcile attaches its watchers asynchronously, and a caller that wrote a
  // skill the moment the spawn returned would land it in the gap before the
  // watch existed (measured: the write was missed on a fast follow-up and
  // picked up once the attach had settled).
  await syncDiscoveryRootsWatch();
  // A `session:<id>` topic subscribed before this spawn had no child to bind
  // to, so it published nothing and its subscribers hold a `running:false`
  // snapshot. The child exists now: tell the realtime layer to re-snapshot
  // that topic for whoever is watching.
  emitRealtimeSignal('session-attached', realSessionId);
  // A forked resume answers a NEW id, and the client is still subscribed (and
  // still posting) under the id it asked for. Publishing only the real id
  // leaves that subscriber attached to a topic whose `getRpcSession` now
  // resolves — through the alias `registerSpawnedSession` installs — while
  // nothing ever told it to re-snapshot, so a reload-less tab would keep the
  // pre-spawn snapshot.
  if (sessionId !== realSessionId) emitRealtimeSignal('session-attached', sessionId);
  return { session: created, realSessionId };
}

// ============================================================================
// The prewarm pool (one idle "new session" spawned ahead of the first prompt)
// lives in `prewarm-pool.ts`: it is a cache with its own lifecycle, not part
// of the live-session map below.
// ============================================================================

/** Consume the prewarmed process for `cwd` when its approval mode matches, or
 *  spawn a fresh session. The returned wrapper is already registered under its
 *  real session id, mirroring startRpcSession's bookkeeping. */
export async function startNewRpcSession(
  cwd: string,
  approvalMode?: ApprovalMode,
  modeEnv?: Record<string, string>,
): Promise<{ session: AgentSessionWrapper; realSessionId: string }> {
  const mode = approvalMode ?? DEFAULT_APPROVAL_MODE;
  // Mint here, not at the route: the prewarmed entry and the cold spawn both
  // get a callback credential, and no caller can forget it.
  const { token, env: agentEnv } = mintAgentEnvironment();
  const env = { ...(modeEnv ?? {}), ...agentEnv };
  const wrapper = await claimPrewarmedSession(cwd, mode, env);

  if (!wrapper) {
    const started = await startRpcSession(`__new__${Bun.randomUUIDv7()}`, '', cwd, undefined, mode, env);
    await rememberAgentToken(started.realSessionId, token).catch((cause: unknown) => {
      console.error(`[sessions] could not record the agent token for ${started.realSessionId}:`, cause);
    });
    return started;
  }

  // A claimed prewarmed process recorded its own token before entering the
  // pool; recording this call's token would invalidate the child's environment.

  const registry = getRegistry();
  const realSessionId = wrapper.sessionId;
  wrapper.onDestroy(() => {
    if (registry.get(wrapper.sessionId) === wrapper) registry.delete(wrapper.sessionId);
    if (registry.get(realSessionId) === wrapper) registry.delete(realSessionId);
  });
  registry.set(realSessionId, wrapper);
  // A prewarmed process is adopted here, not in `startRpcSession`, so this is
  // the only spawn path that sees it — a session's cwd may sit outside every
  // registered workspace, and the discovery watcher has to learn it. Awaited
  // for the same reason as in `startRpcSession`: the attach is asynchronous,
  // and the caller's first write must not land before the watch exists.
  await syncDiscoveryRootsWatch();
  // Same as `startRpcSession`: a topic subscribed against the pre-spawn id (or
  // a placeholder) needs a fresh snapshot now that a child is reachable.
  emitRealtimeSignal('session-attached', realSessionId);
  return { session: wrapper, realSessionId };
}
