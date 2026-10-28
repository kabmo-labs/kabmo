/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Waiting for the server that answered an update to be REPLACED.
 *
 * The update route arms a detached `kabmo restart --port <port>` and
 * answers first (`RESTART_GRACE_MS`, 1.2 s). So when the result says
 * `restarting`, the page is still being served by the process whose build was
 * just replaced: reloading immediately would fetch the OLD bundle back from the
 * server that has not exited yet, and the user would see the previous version
 * with no indication that anything went wrong. The page therefore has to wait
 * for the replacement and only then reload.
 *
 * Identity is what "replaced" means, never a timer: `GET /api/health` reports
 * the serving process's `pid` and `startedAt`, both read before the update
 * starts, so the new process is the one that answers with a DIFFERENT pair.
 * A timer would either reload into the dying process (too short) or leave the
 * user on a stale page after the new one is already up (too long).
 *
 * The polling, the clock and the network read are injected, because the only
 * interesting cases are "the old process still answers", "nothing answers", and
 * "a different process answers" — none of which a live server can be made to
 * produce on demand in a unit test.
 */

/** The facts that identify the process answering `GET /api/health`. */
export interface ServerIdentity {
  pid: number | null;
  startedAt: string | null;
  /** Seconds since that process started, as `/api/health` reports it. */
  uptime: number | null;
}

/** How often the console asks whether the replacement is up. */
export const RESTART_POLL_INTERVAL_MS = 500;

/**
 * Ceiling on the whole wait. A restart is a SIGTERM (escalated to SIGKILL after
 * 5 s) followed by a fresh boot, so anything past this is not a slow start.
 */
export const RESTART_WAIT_TIMEOUT_MS = 30_000;

/** One probe's own timeout, so a hung socket cannot stall the loop. */
export const RESTART_PROBE_TIMEOUT_MS = 2_000;

/**
 * How young a process has to be to count as the replacement when the baseline
 * could not be read. The update itself runs for minutes, so the process serving
 * this page is far older than this by the time a result arrives.
 */
export const REPLACEMENT_MAX_UPTIME_S = 15;

export type RestartWatchOutcome = 'restarted' | 'timeout' | 'aborted';

export interface RestartWatchDeps {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  intervalMs?: number;
  /** Ceiling on the whole wait. */
  timeoutMs?: number;
  /** Ceiling on one probe's own request. */
  probeTimeoutMs?: number;
  /**
   * Stops the wait. Checked between probes, and the probe in flight is bounded
   * by its own `probeTimeoutMs`, so an abort lands within that ceiling.
   */
  signal?: AbortSignal;
}

/** A `/api/health` payload, narrowed to the fields identity is read from. */
export function parseServerIdentity(payload: unknown): ServerIdentity | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const record = payload as Record<string, unknown>;
  const pid = typeof record.pid === 'number' && Number.isFinite(record.pid) ? record.pid : null;
  const startedAt = typeof record.startedAt === 'string' && record.startedAt.length > 0 ? record.startedAt : null;
  const uptime = typeof record.uptime === 'number' && Number.isFinite(record.uptime) ? record.uptime : null;
  // A payload naming neither a pid nor a start time identifies nothing, and
  // treating it as an identity would make every later probe look like a match.
  if (pid === null && startedAt === null) return null;
  return { pid, startedAt, uptime };
}

/**
 * Whether `current` is a process OTHER than the one `before` describes.
 *
 * With a baseline, any disagreement on pid or start time is the replacement —
 * a restarted process is never the same process. Without one (the health read
 * before the update failed), a young uptime is the only evidence available, and
 * it is evidence the update's own duration makes safe: the run takes minutes,
 * so a process a few seconds old cannot be the one that started it.
 */
export function isReplacement(before: ServerIdentity | null, current: ServerIdentity): boolean {
  if (!before) return current.uptime !== null && current.uptime <= REPLACEMENT_MAX_UPTIME_S;
  if (before.pid !== null && current.pid !== null && before.pid !== current.pid) return true;
  if (before.startedAt !== null && current.startedAt !== null && before.startedAt !== current.startedAt) return true;
  return false;
}

/** The serving process's identity, or null when it cannot be read. */
export async function readServerIdentity(deps: RestartWatchDeps = {}): Promise<ServerIdentity | null> {
  const fetchImpl = deps.fetch ?? fetch;
  try {
    const response = await fetchImpl('/api/health', {
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(deps.probeTimeoutMs ?? RESTART_PROBE_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return parseServerIdentity(await response.json());
  } catch {
    return null;
  }
}

function defaultSleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

/**
 * Poll until a process other than `before` answers, the deadline passes, or
 * `signal` aborts. A failed probe is EXPECTED here — the old server is exiting
 * and the port is briefly unbound — so only a successful, different answer
 * counts as the replacement.
 */
export async function waitForServerRestart(
  before: ServerIdentity | null,
  deps: RestartWatchDeps = {},
): Promise<RestartWatchOutcome> {
  const fetchImpl = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? (() => Date.now());
  const interval = deps.intervalMs ?? RESTART_POLL_INTERVAL_MS;
  const deadline = now() + (deps.timeoutMs ?? RESTART_WAIT_TIMEOUT_MS);

  for (;;) {
    if (deps.signal?.aborted) return 'aborted';

    const current = await readServerIdentity({ fetch: fetchImpl, probeTimeoutMs: deps.probeTimeoutMs });
    if (current && isReplacement(before, current)) return 'restarted';

    if (now() >= deadline) return 'timeout';
    await sleep(interval);
  }
}
