// Ending one live instance: signal it, confirm it is gone, then clear its
// record.
//
// Kept apart from `runtime.js` (discovery, health probing, spawning) because the
// two defects this module exists to prevent are both about IDENTITY and
// OWNERSHIP, and a reader looking for "what happens when I run `ompchamber stop`"
// should land here rather than in the middle of the discovery helpers.

import { killChildTree, STOP_TIMEOUT_MS } from '@/cli/lib/process-lifecycle.js';
import { getProcessState, isProcessAlive } from '@/server/lib/lifecycle/identity';
import { removeInstanceRecord } from '@/server/lib/lifecycle/instance';
import { findOccupant } from '@/server/lib/lifecycle/occupant';

/**
 * The questions this module asks about the world, injectable for the same
 * reason `ScheduleDeps` exists. Two of them cannot be produced honestly on a
 * POSIX host — the Windows identity answer (`proc/win32.ts` reads no command
 * line, so `getProcessState` answers `unknown` for every PID there) and a
 * process that refuses to die — and `mock.module` is not an option: it swaps the
 * probe for the WHOLE `bun test` run, which broke eight unrelated suites when it
 * was tried.
 *
 * `signal` is a seam rather than a direct `process.kill` for a blunter reason:
 * on POSIX the kill is a GROUP kill (`-pid`), so a test that lets it run reaches
 * the test runner's own process group. A caller never passes this; the defaults
 * are the real functions.
 */
export const stopDeps = {
  getProcessState,
  findOccupant,
  isAlive: isProcessAlive,
  signal: (pid, force) => {
    killChildTree({ pid, kill: (signal) => process.kill(pid, signal) }, force);
  },
};

function waitForProcessExit(pid, timeoutMs, isAlive) {
  if (!isAlive(pid)) return Promise.resolve(true);
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const tick = () => {
      if (!isAlive(pid)) {
        resolve(true);
        return;
      }
      if (Date.now() >= deadline) {
        resolve(false);
        return;
      }
      setTimeout(tick, 100);
    };
    tick();
  });
}

/**
 * SIGTERM the process, escalate to SIGKILL after the timeout, then drop the
 * instance record — but only once the process is actually gone. Resolves true
 * only when nothing of ours is left running.
 *
 * Two defects made this command lie on Windows, and both are fixed here.
 *
 * 1. Identity could not be read, and that was read as "not ours". The Windows
 *    probe cannot read another process's command line (`proc/win32.ts`), so
 *    `getProcessState` answers `unknown` for every PID there — including the
 *    server's own. The guard treated anything but `matched` as a stranger, so a
 *    record-only entry took the early return: the record was deleted, `true` was
 *    returned, and `ompchamber stop` printed "✓ Stopped" while the server kept
 *    listening on the port. Measured on Windows: the process was never
 *    signalled at all.
 *
 *    The port is the witness that was missing. `findOccupant` combines the
 *    record with a `/api/health` probe, so it answers who is serving the port
 *    even when the OS cannot say who a PID is. Only when it names a DIFFERENT
 *    PID — another instance, or nothing at all — is the record stale and the
 *    entry dropped without a signal. A server that is alive but deaf (hung,
 *    still starting) still answers from its own record, which is the case that
 *    would otherwise be unstoppable.
 *
 * 2. The record was dropped unconditionally, even when the escalation could not
 *    end the process. That is what turned a failed stop into a deadlock: the
 *    record is the only source `listLiveInstances` has, so `status` and a plain
 *    `stop` then reported "not running" while `serve` — which probes the port —
 *    refused to start. Keeping the record is what makes the instance findable
 *    again; the caller reports the failure from the returned value.
 */
export async function stopInstance(entry, { timeoutMs = STOP_TIMEOUT_MS, deps = stopDeps } = {}) {
  const port = entry?.port;
  const pid = Number(entry?.pid);
  const dropRecord = async () => {
    if (port !== undefined && port !== null) removeInstanceRecord(port);
  };

  if (!Number.isInteger(pid) || pid <= 0 || !deps.isAlive(pid)) {
    await dropRecord();
    return true;
  }

  const confirmedByProbe = entry?.source === 'probe' || entry?.source === 'registry+probe';
  if (!confirmedByProbe && deps.getProcessState(pid) !== 'matched') {
    const occupant = port === undefined || port === null ? null : await deps.findOccupant(port, entry?.host);
    if (occupant?.pid !== pid) {
      // The PID is alive but is not the OMPChamber serving this port (a
      // recycled PID, a foreign listener, or a port nothing holds): a stranger
      // is never signalled, and the stale record is the only thing to remove.
      await dropRecord();
      return true;
    }
  }

  deps.signal(pid, false);
  let gone = await waitForProcessExit(pid, timeoutMs, deps.isAlive);
  if (!gone) {
    deps.signal(pid, true);
    gone = await waitForProcessExit(pid, timeoutMs, deps.isAlive);
  }

  if (gone) await dropRecord();
  return gone;
}
