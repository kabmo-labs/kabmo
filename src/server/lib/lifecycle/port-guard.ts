/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Port guarding for a starting Kabmo server.
 *
 * One port is served by exactly one process, and **a starting instance never
 * stops another one** — not a CLI server, not a dev run. An occupant that
 * identifies itself as Kabmo makes the newcomer exit with the ways to pick
 * a different port; freeing a port is what `ompchamber stop --port <port>` is
 * for, done deliberately and per port.
 *
 * The refusal is load-bearing rather than defensive: a second bind is *not*
 * refused by the runtime (Elysia's Bun adapter hardcodes `reusePort: true`), so
 * two servers would coexist on one port and only the first-bound socket would
 * receive connections. The newcomer would look healthy in its own log while the
 * browser kept talking to the old build; the guard stops that state from being
 * created in the first place.
 */

import fs from 'fs';

import { flockAvailable, tryFlock } from '@/server/lib/lifecycle/flock';
import { getProcessState } from '@/server/lib/lifecycle/identity';
import { describeOccupant, findOccupant } from '@/server/lib/lifecycle/occupant';
import { getLockPath } from '@/server/lib/lifecycle/paths';
import { isPortAvailable } from '@/server/lib/lifecycle/probe';

const LOCK_WAIT_MS = 3_000;
/** Grace period for a port that is settling (a server that just exited, or one that is starting). */
const SETTLE_WAIT_MS = 3_000;

export class PortInUseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PortInUseError';
  }
}

export interface PortLock {
  release: () => void;
}

/**
 * Exclusive per-port startup lock.
 *
 * Two starters racing on one free port would each probe it as free and then
 * fight over the bind, with the loser reporting a bare `EADDRINUSE` against a
 * process it cannot identify yet. Holding the lock across probe-and-bind makes
 * the loser fail with a message that names the actual situation.
 *
 * The mechanism is `flock(2)` when the host has it (see `flock.ts`): the kernel
 * releases it on process death, so there is no stale-holder case to detect and
 * no polling loop. The PID-file path below stays as the fallback for a host
 * without `flock` (Windows, a filesystem answering `ENOLCK`); it needs the
 * extra machinery — PID readback, `getProcessState` classification, and
 * reclaiming a lock whose holder died or whose PID was recycled.
 */
export async function acquirePortLock(port: number, waitMs = LOCK_WAIT_MS): Promise<PortLock | null> {
  const lockPath = getLockPath(port);
  if (flockAvailable()) {
    const deadline = Date.now() + waitMs;
    for (;;) {
      const handle = tryFlock(lockPath);
      if (handle) return handle;
      if (Date.now() >= deadline) return null;
      await Bun.sleep(150);
    }
  }

  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx', mode: 0o600 });
      return { release: () => releasePortLock(lockPath) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') return null;
    }

    let holder = Number.NaN;
    try {
      holder = Number(fs.readFileSync(lockPath, 'utf8').trim());
    } catch {
      continue;
    }

    const holderState = Number.isFinite(holder) && holder > 0 ? getProcessState(holder) : 'dead';
    if (holderState === 'dead' || holderState === 'mismatched') {
      fs.rmSync(lockPath, { force: true });
      continue;
    }
    if (holder === process.pid) return { release: () => releasePortLock(lockPath) };
    if (Date.now() >= deadline) return null;
    await Bun.sleep(150);
  }
}

function releasePortLock(lockPath: string): void {
  try {
    if (fs.readFileSync(lockPath, 'utf8').trim() === String(process.pid)) fs.rmSync(lockPath, { force: true });
  } catch {
    // Already gone, or never ours to remove.
  }
}

export interface ClaimPortOptions {
  port: number;
  host: string;
  /**
   * Binds the port; must throw when the OS refuses. Retried while the port
   * looks occupied by something that is not an identified Kabmo instance.
   */
  listen: () => Promise<void>;
}

/**
 * Bind `port`, or fail with an actionable error.
 *
 * The bind is the authoritative question ("can this process listen here") and
 * `listen` is what answers it; the probe only short-circuits the common case.
 * When either says the port is taken, the occupant is identified so the error
 * can name it — and then the process exits, leaving every other instance
 * running.
 */
export async function claimPort({ port, host, listen }: ClaimPortOptions): Promise<void> {
  const deadline = Date.now() + SETTLE_WAIT_MS;
  let bindError: unknown = null;

  for (;;) {
    if (await isPortAvailable(port, host)) {
      try {
        await listen();
        return;
      } catch (error) {
        bindError = error;
      }
    }

    const occupant = await findOccupant(port, host);

    // `bun run --hot` re-evaluates this entry inside the running process, so the
    // port is held by *us* and Bun swaps the fetch handler on the next `listen`.
    // Treating that as a conflict would kill the dev loop on every save.
    if (occupant && occupant.pid === process.pid) {
      await listen();
      return;
    }

    if (occupant) throw await buildPortInUseError(port, host, bindError);

    if (Date.now() >= deadline) throw await buildPortInUseError(port, host, bindError);
    await Bun.sleep(200);
  }
}

/** Every way to point this server at another port. */
function portGuidance(): string {
  return [
    '    ompchamber serve --port 3001',
    '    OMPCHAMBER_PORT=3001 ompchamber serve',
    '    PORT=3001 bun run dev          # or: PORT=3001 bun run start',
  ].join('\n');
}

async function buildPortInUseError(port: number, host: string, bindError: unknown): Promise<PortInUseError> {
  const occupant = await findOccupant(port, host);
  const bindDetail = bindError instanceof Error ? `\n  Bind error: ${bindError.message}` : '';

  if (occupant) {
    return new PortInUseError(
      `Port ${port} is already served by Kabmo ${describeOccupant(occupant)}.\n`
      + `  Nothing was stopped — a starting instance never stops another one.\n`
      + `  Stop it first:  ompchamber stop --port ${port}\n`
      + `  Or start on another port:\n${portGuidance()}`,
    );
  }

  return new PortInUseError(
    `Port ${port} is in use by another process (no Kabmo instance answered on it).${bindDetail}\n`
    + `  Find it with:  lsof -nP -iTCP:${port} -sTCP:LISTEN\n`
    + `  Start on another port:\n${portGuidance()}`,
  );
}
