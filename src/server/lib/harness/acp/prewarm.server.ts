/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The ACP prewarm pool: one started *process*, spawned ahead of the first
 * prompt so the send adopts it instead of paying the agent's boot.
 *
 * A cold ACP chat costs a process spawn and an `initialize` handshake before
 * `session/new` can even be asked. Measured on `omp-acp`: ~1 ms spawn, ~100 ms
 * `initialize`, ~80-120 ms `session/new`. The first two do not depend on what
 * the user is about to type, so they happen while the prompt is written.
 *
 * **Only `initialize`. Deliberately.** Warming through `session/new` was tried
 * and reverted: `omp-acp` writes its session JSONL at that moment, and Kabmo's
 * sidebar scans that directory — so a warm child that nobody claimed appeared as
 * an empty chat row (measured: the file lands before any prompt, and it outlives
 * the child). A prewarm must be invisible, so it stops at the handshake that
 * creates nothing.
 *
 * **Why this pool can be warmer than omp's.** omp's modes ride the spawn
 * ENVIRONMENT (`KABMO_MODES`), read once at session start, so an entry whose
 * selection differs has to be killed. ACP publishes model, thinking level and
 * mode as config selectors and the approval tier as in-process state; the
 * adopting session applies them after `session/new`, exactly as a cold spawn
 * does. A prewarmed process therefore serves ANY pick.
 *
 * The pool is keyed by harness + cwd. One pending chat runs one agent, so a
 * second pick in the same folder replaces the first candidate; an unclaimed
 * entry is also disposed after `ACP_PREWARM_TTL_MS`.
 */

import { mintAgentEnvironment } from '@/server/lib/sessions/agent-token.server';
import { loadHarnessConfig, resolveLaunch } from '@/server/lib/harness/config.server';
import { sessionLaunchCommand } from '@/server/lib/harness/launch';
import { AcpProcess } from '@/server/lib/harness/acp/client';
import { IDLE_REAP_MS } from '@/server/lib/omp/rpc/constants';
import { withGatewayCompatibility } from '@/server/lib/harness/acp/gateway-env';
import { noteHarnessLease, removeHarnessLease } from '@/server/lib/harness/session-lease.server';
import type { HarnessId } from '@/shared/lib/harness/catalog';

/** How long an unclaimed warm agent is kept. Long enough to write a prompt,
 *  short enough that a pick the user abandoned costs one process, not a day. */
export const ACP_PREWARM_TTL_MS = IDLE_REAP_MS;

/** A spawned, initialized agent waiting for the chat that will adopt it. */
export interface PrewarmedAcp {
  process: AcpProcess;
  /** The callback credential its environment carries; the claim records it
   *  against the session id `session/new` answers. */
  token: string;
}

export interface PrewarmedAcpEntry {
  harness: HarnessId;
  cwd: string;
  createdAt: number;
  /** Set by the claim BEFORE it awaits readiness: two sends racing one entry
   *  must not both adopt it. */
  claimed: boolean;
  /** Resolves the warm process, or null when the spawn failed or the child died
   *  before it was claimed. Never rejects — an entry nobody claims must not
   *  surface as an unhandled rejection. */
  ready: Promise<PrewarmedAcp | null>;
}

declare global {
  // eslint-disable-next-line no-var
  var __kabmoAcpPrewarmed: Map<string, PrewarmedAcpEntry> | undefined;
}

export function getPrewarmedAcp(): Map<string, PrewarmedAcpEntry> {
  globalThis.__kabmoAcpPrewarmed ??= new Map();
  return globalThis.__kabmoAcpPrewarmed;
}

/** One entry per harness AND cwd: two agents in one folder are two processes. */
export function acpPrewarmKey(harness: HarnessId, cwd: string): string {
  return `${harness}\u0000${cwd}`;
}

/** The seam a test drives; the real opener spawns a process. */
export interface AcpPrewarmDeps {
  open: (harness: HarnessId, cwd: string) => Promise<PrewarmedAcp>;
}

/** The launch line and env a prewarm — and the spawn that adopts it — use. */
async function openProcess(harness: HarnessId, cwd: string): Promise<PrewarmedAcp> {
  const configured = await loadHarnessConfig(harness);
  const launch = resolveLaunch(harness, configured);
  const { token, env } = mintAgentEnvironment();
  const merged = withGatewayCompatibility(harness, { ...(launch.env ?? {}), ...env });
  const process = new AcpProcess({
    command: sessionLaunchCommand(harness, launch.command),
    cwd,
    ...(merged ? { env: merged } : {}),
    // Nobody owns this child yet. The adopting session re-binds these sinks; a
    // frame that arrives in between is an unsolicited status update, which a
    // session learns from `session/new` anyway.
    onNotification: () => {},
    onStderr: () => {},
  });
  // A prewarm is a real process the Stats panel must be able to name: without
  // this lease it is a bare `npx` row inside Kabmo's own group. The claim
  // overwrites the record with the session's id and title, keeping `startedAt`.
  const pid = process.pid;
  if (pid) noteHarnessLease({ pid, harness, cwd, state: 'prewarm' });
  try {
    await process.initialize();
  } catch (error) {
    if (pid) removeHarnessLease(pid);
    throw error;
  }
  if (!process.isAlive) {
    if (pid) removeHarnessLease(pid);
    await process.dispose(1_000).catch(() => {});
    throw new Error(`${harness} exited while warming`);
  }
  return { process, token };
}

const defaultDeps: AcpPrewarmDeps = { open: openProcess };

/** Drop an unclaimed entry and dispose its child. */
async function discard(key: string): Promise<void> {
  const pool = getPrewarmedAcp();
  const entry = pool.get(key);
  if (!entry || entry.claimed) return;
  entry.claimed = true;
  pool.delete(key);
  const warm = await entry.ready;
  if (warm?.process.pid) removeHarnessLease(warm.process.pid);
  await warm?.process.dispose(1_000).catch(() => {});
}

/**
 * Drop the warm agents for `cwd` that belong to OTHER harnesses.
 *
 * One pending chat runs one agent, so the previous candidate is spent: keeping
 * it would cost a process for a choice the operator already left.
 */
async function discardOtherPrewarms(harness: HarnessId, cwd: string): Promise<void> {
  const doomed = [...getPrewarmedAcp()]
    .filter(([, entry]) => entry.cwd === cwd && entry.harness !== harness && !entry.claimed)
    .map(([key]) => key);
  await Promise.all(doomed.map((key) => discard(key)));
}

/**
 * Spawn (at most one) idle agent for `harness` in `cwd` so the next new-chat
 * send starts instantly. Fire-and-forget; a failed spawn just clears itself.
 * Safe to call repeatedly — an existing live or in-flight entry wins.
 */
export function prewarmAcpSession(
  harness: HarnessId,
  cwd: string,
  deps: AcpPrewarmDeps = defaultDeps,
): void {
  const pool = getPrewarmedAcp();
  const key = acpPrewarmKey(harness, cwd);
  if (pool.has(key)) return;
  // Fire-and-forget on purpose: the old entry's teardown must not delay this
  // agent's boot, and `discard` marks it claimed before awaiting anything.
  void discardOtherPrewarms(harness, cwd);

  const entry: PrewarmedAcpEntry = {
    harness,
    cwd,
    createdAt: Date.now(),
    claimed: false,
    ready: Promise.resolve(null),
  };
  entry.ready = deps.open(harness, cwd)
    .then(async (warm) => {
      // A child that died while warming must not be handed out.
      if (warm.process.isAlive) return warm;
      await warm.process.dispose(1_000).catch(() => {});
      return null;
    })
    .catch((error: unknown) => {
      console.error(`[harness] prewarm of ${harness} in ${cwd} failed:`, error);
      return null;
    })
    .then((warm) => {
      // A failed spawn leaves no entry: the next prewarm retries instead of
      // finding a permanently empty slot.
      if (!warm && pool.get(key) === entry) pool.delete(key);
      return warm;
    });
  pool.set(key, entry);

  const timer = setTimeout(() => {
    void discard(key);
  }, ACP_PREWARM_TTL_MS);
  // A warm child must not keep the process alive on its own.
  timer.unref?.();
}

/**
 * Take the prewarmed agent for `harness`+`cwd`, or null when there is none to
 * take. The claim is a synchronous check-and-set: two sends racing the same
 * entry must not both adopt it.
 */
export async function claimPrewarmedAcpSession(
  harness: HarnessId,
  cwd: string,
): Promise<PrewarmedAcp | null> {
  const pool = getPrewarmedAcp();
  const key = acpPrewarmKey(harness, cwd);
  const entry = pool.get(key);
  if (!entry || entry.claimed) return null;
  entry.claimed = true;
  pool.delete(key);
  const warm = await entry.ready;
  if (warm?.process.isAlive) return warm;
  if (warm?.process.pid) removeHarnessLease(warm.process.pid);
  await warm?.process.dispose(1_000).catch(() => {});
  return null;
}

/**
 * Recycle every UNCLAIMED prewarmed agent.
 *
 * A warm child is a full agent process spawned from whatever binary was current
 * when the user opened a pending chat. After an adapter update it is a stale
 * build waiting to be adopted by the next send, so the recycle happens here
 * rather than being left to the TTL. Safe because an unclaimed entry owns no
 * session and no turn.
 */
export async function restartPrewarmedAcpSessions(): Promise<number> {
  const doomed = [...getPrewarmedAcp().entries()]
    .filter(([, entry]) => !entry.claimed)
    .map(([key]) => key);
  await Promise.all(doomed.map((key) => discard(key)));
  return doomed.length;
}
