/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The prewarm pool: one idle "new session" spawned ahead of the first prompt
 * so adopting it on send skips the multi-second omp boot.
 *
 * Split out of `session-registry.ts` so that file stays under the repo's
 * per-file size ceiling: the pool is a concern of its own (a cache with its
 * own lifecycle), and the registry is the map of LIVE sessions.
 *
 * Keyed per cwd (the spawn's project directory) with its approval mode and
 * mode selection; consumed exactly once by `startNewRpcSession`.
 */

import { RpcProcess } from '@/server/lib/omp/rpc/process';
import { buildSessionSpawnArgs } from '@/server/lib/omp/rpc/constants';
import { AgentSessionWrapper } from '@/server/lib/omp/rpc/manager';
import { recordSpawnProvenance } from '@/server/lib/omp/rpc/spawn-provenance';
import { DEFAULT_APPROVAL_MODE, type ApprovalMode } from '@/shared/lib/omp/config/access-mode';

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

export function getPrewarmed(): Map<string, PrewarmedEntry> {
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

/**
 * Take the prewarmed process for `cwd` when it can serve the request.
 *
 * Returns the wrapper, or null when there is none to take: no entry, an entry
 * whose approval mode or mode selection differs from the request's, or an
 * entry that died before it was claimed. The mismatching entry is destroyed —
 * it cannot serve this request — and the caller spawns cold.
 */
export async function claimPrewarmedSession(
  cwd: string,
  approvalMode: ApprovalMode,
  modeEnv?: Record<string, string>,
): Promise<AgentSessionWrapper | null> {
  const pool = getPrewarmed();
  const entry = pool.get(cwd);
  if (!entry) return null;

  // A prewarmed entry was spawned with the environment current at prewarm
  // time, so a MODE selection that differs from its own can no longer be served
  // by it — the extension reads the mode env once, at session start. Treated
  // exactly like a mode mismatch: claim and kill, then spawn cold.
  const entryModes = entry.modeEnv?.KABMO_MODES ?? entry.modeEnv?.CHAMBER_MODES ?? '';
  const wantedModes = modeEnv?.KABMO_MODES ?? modeEnv?.CHAMBER_MODES ?? '';
  const usable = !entry.claimed && entry.approvalMode === approvalMode && entryModes === wantedModes;

  if (usable) {
    entry.claimed = true;
    pool.delete(cwd);
    try {
      const candidate = await entry.ready;
      // Died between readiness and claim (idle kill, crash) → cold spawn.
      if (candidate.isAlive()) return candidate;
      await candidate.destroyAndWait();
    } catch {
      // fall through to a cold spawn
    }
    return null;
  }

  if (entry.claimed) return null;
  // Wrong approval mode, or a different session-mode selection: the prewarmed
  // process cannot serve this request. Kill it and spawn cold —
  // reconcileSpawnApprovalMode would refuse (no session file).
  entry.claimed = true;
  pool.delete(cwd);
  void entry.ready.then((w) => w.destroyAndWait()).catch(() => {});
  return null;
}
