/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
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
import { recordSpawnProvenance } from '@/server/lib/omp/rpc/spawn-provenance';
import { registerSpawnedSession } from '@/server/lib/omp/rpc/session-registration';
import { resolveSessionOwnership, SessionOwnedElsewhereError } from '@/server/lib/omp/session/ownership.server';
import { DEFAULT_APPROVAL_MODE, type ApprovalMode } from '@/shared/lib/omp/config/access-mode';

export { getSpawnApprovalMode, getSpawnModeEnv, reconcileSpawnApprovalMode } from '@/server/lib/omp/rpc/spawn-provenance';

declare global {
  // eslint-disable-next-line no-var
  var __ompSessions: Map<string, AgentSessionWrapper> | undefined;
  // eslint-disable-next-line no-var
  var __ompStartLocks: Map<string, Promise<{ session: AgentSessionWrapper; realSessionId: string }>> | undefined;
}

function getRegistry(): Map<string, AgentSessionWrapper> {
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

export function getRpcSession(sessionId: string): AgentSessionWrapper | undefined {
  return getRegistry().get(sessionId);
}

/** Every live session wrapper, for operations that must reach all of them
 *  (a plugin/skill reload) rather than one addressed id. */
export function listRpcSessions(): AgentSessionWrapper[] {
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
 * judged from the row's `owner_pid` and OS liveness so every instance agrees.
 * The two answer different questions and must not be conflated:
 *
 *   - `isStaleStreamRow` asks "did the process that wrote this row die?" —
 *     answerable from the row alone, so all instances reach one verdict;
 *   - this asks "does THIS process still hold a run for the session it claims?"
 *     — only this process can answer, and it is the only thing that can release
 *     a row whose owner is alive but whose run is gone (a dropped prompt, a
 *     lost `agent_end`). No other instance can see it, and the OS cannot help.
 *
 * `isRunning()` is the same predicate `GET /api/agent/:id` reports as `busy`,
 * so the sidebar's spinner and the attach probe cannot disagree.
 */
export function getLiveRunSessionIds(): Set<string> {
  const ids = new Set<string>();
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
): Promise<{ session: AgentSessionWrapper; realSessionId: string }> {
  const registry = getRegistry();
  const locks = getLocks();

  const existing = registry.get(sessionId);
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
  // local registry above cannot see a second chamber instance, so ownership is
  // read from omp's own lease (see ownership.server.ts).
  if (sessionFile) {
    const ownership = await resolveSessionOwnership(sessionId);
    if (ownership) throw new SessionOwnedElsewhereError(sessionId, ownership);
  }

  const inflight = locks.get(sessionId);
  if (inflight) return inflight;

  const starting = (async () => {
    const holder: { wrapper?: AgentSessionWrapper } = {};
    const proc = new RpcProcess({
      cwd,
      extraArgs: buildSessionSpawnArgs(sessionFile, approvalMode),
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
  })().finally(() => locks.delete(sessionId));

  locks.set(sessionId, starting);
  return starting;
}

// ============================================================================
// Prewarm pool: one idle "new session" spawned ahead of the first prompt so
// adopting it on send skips the multi-second omp boot. Keyed per cwd (the
// spawn's project directory) with its approval mode; consumed exactly once by
// startNewRpcSession.
// ============================================================================

interface PrewarmedEntry {
  cwd: string;
  approvalMode: ApprovalMode;
  /** Mode selection the entry was spawned with; a mismatch makes it unusable. */
  modeEnv?: Record<string, string>;
  /** Resolves when the wrapper is ready, or rejects when the spawn failed or
   *  the entry was torn down before being claimed. */
  ready: Promise<AgentSessionWrapper>;
  claimed: boolean;
}

declare global {
  // eslint-disable-next-line no-var
  var __ompPrewarmed: Map<string, PrewarmedEntry> | undefined;
}

function getPrewarmed(): Map<string, PrewarmedEntry> {
  if (!globalThis.__ompPrewarmed) globalThis.__ompPrewarmed = new Map();
  return globalThis.__ompPrewarmed;
}

/** Spawn (at most one) idle omp process for `cwd` so the next new-session
 *  send starts instantly. Fire-and-forget; a failed spawn just clears itself.
 *  Safe to call repeatedly — an existing live or in-flight entry wins. */
export function prewarmRpcSession(cwd: string, approvalMode?: ApprovalMode, modeEnv?: Record<string, string>): void {
  const pool = getPrewarmed();
  const existing = pool.get(cwd);
  if (existing) return;
  const mode = approvalMode ?? DEFAULT_APPROVAL_MODE;
  // A pending chat has no mode selection yet, so its prewarmed process is
  // spawned with none — the first send races it and any real selection kills
  // the entry (see `startNewRpcSession`).
  const holder: { wrapper?: AgentSessionWrapper } = {};
  const proc = new RpcProcess({
    cwd,
    extraArgs: buildSessionSpawnArgs('', mode),
    env: modeEnv,
    onExit: ({ stderrTail }) => holder.wrapper?.handleProcessExit(stderrTail),
  });
  const wrapper = new AgentSessionWrapper(proc, cwd);
  recordSpawnProvenance(wrapper, mode, modeEnv);
  holder.wrapper = wrapper;
  wrapper.start();
  const ready = wrapper
    .waitUntilReady()
    .then(() => {
      // A dead wrapper (idle-kill, crash, exit) must not be handed out.
      if (!wrapper.isAlive()) throw new Error('prewarmed process exited');
      return wrapper;
    })
    .catch((error) => {
      void wrapper.destroyAndWait();
      const entry = pool.get(cwd);
      if (entry?.ready === ready) pool.delete(cwd);
      throw error;
    });
  pool.set(cwd, { cwd, approvalMode: mode, modeEnv, ready, claimed: false });
}

/**
 * Recycle every UNCLAIMED prewarmed process.
 *
 * A prewarmed child is a full session host that has no session yet, spawned
 * from whatever binary was current when the user opened a pending chat. After
 * `omp update` it is a stale build waiting to be adopted by the next send, so
 * the recycle happens here rather than being left to the idle timer.
 *
 * Safe because there is nothing to lose: an unclaimed entry owns no session and
 * no turn. An entry a send is already adopting is left alone — the claim is a
 * synchronous check-and-set (`startNewRpcSession`), so an entry is either taken
 * before this pass reads it or taken after this pass removed it, never both.
 * A wrapper still booting is destroyed through `destroyAndWait`, which is also
 * the error path the prewarm itself would have taken.
 */
export async function restartPrewarmedSessions(): Promise<number> {
  const pool = getPrewarmed();
  if (pool.size === 0) return 0;
  const doomed: PrewarmedEntry[] = [];
  for (const [cwd, entry] of pool) {
    if (entry.claimed) continue;
    entry.claimed = true;
    pool.delete(cwd);
    doomed.push(entry);
  }
  await Promise.all(doomed.map(async (entry) => {
    try {
      const wrapper = await entry.ready;
      await wrapper.destroyAndWait();
    } catch {
      // A spawn that failed already tore its own wrapper down; nothing to do.
    }
  }));
  return doomed.length;
}

/** Consume the prewarmed process for `cwd` when its approval mode matches, or
 *  spawn a fresh session. The returned wrapper is already registered under its
 *  real session id, mirroring startRpcSession's bookkeeping. */
export async function startNewRpcSession(
  cwd: string,
  approvalMode?: ApprovalMode,
  modeEnv?: Record<string, string>,
): Promise<{ session: AgentSessionWrapper; realSessionId: string }> {
  const pool = getPrewarmed();
  const entry = pool.get(cwd);
  const mode = approvalMode ?? DEFAULT_APPROVAL_MODE;
  let wrapper: AgentSessionWrapper | undefined;
  // A prewarmed entry was spawned with the environment current at prewarm
  // time, so a MODE selection that differs from its own can no longer be served
  // by it — the extension reads `CHAMBER_MODES` once, at session start. Treated
  // exactly like a mode mismatch: claim and kill, then spawn cold.
  const entryModes = entry?.modeEnv?.CHAMBER_MODES ?? '';
  const wantedModes = modeEnv?.CHAMBER_MODES ?? '';
  if (entry && !entry.claimed && entry.approvalMode === mode && entryModes === wantedModes) {
    entry.claimed = true;
    pool.delete(cwd);
    try {
      const candidate = await entry.ready;
      // Died between readiness and claim (idle kill, crash) → cold spawn.
      if (candidate.isAlive()) wrapper = candidate;
      else await candidate.destroyAndWait();
    } catch {
      wrapper = undefined; // fall through to a cold spawn
    }
  } else if (entry && !entry.claimed) {
    // Wrong approval mode, or a different session-mode selection: the prewarmed
    // process cannot serve this request. Kill it and spawn cold —
    // reconcileSpawnApprovalMode would refuse (no session file).
    entry.claimed = true;
    pool.delete(cwd);
    void entry.ready.then((w) => w.destroyAndWait()).catch(() => {});
  }

  if (!wrapper) {
    return startRpcSession(`__new__${Bun.randomUUIDv7()}`, '', cwd, undefined, mode, modeEnv);
  }

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
