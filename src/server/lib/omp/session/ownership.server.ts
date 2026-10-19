/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Cross-process session ownership: who else is writing this session file, and
 * which Kabmo instances owns that writer.
 *
 * ## Why this exists
 *
 * omp 18.5.0 introduced a per-session ownership lease
 * (`~/.omp/run/session-owners/<id>.lock`, an OS `flock` held for the life of
 * the omp process that opened the session). A second omp process that resumes a
 * file whose lease is already held is NOT allowed to mix its entries in: it
 * moves itself to a sibling file with a new session id and `parentSession`
 * pointing at the old one (`reason: "open-elsewhere"`).
 *
 * The Kabmo's own registry (`globalThis.__ompSessions`) is PER PROCESS, so
 * `startRpcSession` cannot see a session a second Kabmo instances is already
 * running. Resuming that file is exactly the case omp forks — the user sees a
 * duplicate sidebar row with the same title (both files share the opening
 * message), and their conversation is split across two files.
 *
 * Verified by reproduction: one Kabmo instance running a session, a second
 * instance sending a prompt to the same id, and omp logging
 * `Session moved to a new file … open-elsewhere` within a second.
 *
 * ## Two questions, both answered without a subprocess
 *
 *   - "Is the lease held?" — a non-blocking `flock` (`lease-flock.server.ts`),
 *     the same primitive omp takes.
 *   - "Who holds it?" — the pid with an open descriptor on the lease file,
 *     found by walking the process table (`lease-holder.server.ts`, FFI on
 *     macOS, `/proc` on Linux). This is what `lsof -t` answers, asked directly.
 *
 * The holder's PARENT is then matched against Kabmo's instance records:
 * an omp child is spawned by a server, so its parent IS the instance a client
 * must be relayed to. That also tells a foreign writer from this process's own
 * child (a stale registry entry is parented by us).
 */

import fs from 'fs';
import path from 'path';
import { isProcessAlive } from '@/server/lib/lifecycle/identity';
import { getConfigRoot } from '@/server/lib/omp/core/paths';
import { listInstanceRecords, type InstanceRecord } from '@/server/lib/lifecycle/instance';
import { leaseHeldByAnother } from '@/server/lib/omp/session/lease-flock.server';
import { fileHolderPid } from '@/server/lib/omp/session/lease-holder.server';
import { processParentPid } from '@/server/lib/lifecycle/identity';

/** Who is holding a session's omp ownership lease. */
export interface SessionOwnership {
  /** OS pid of the omp process holding the lease, when Kabmo can name it. */
  holderPid: number | null;
  /**
   * The Kabmo instance serving that holder, when it can be resolved. Null
   * when the holder cannot be placed (an `omp` CLI run has no instance record)
   * — the caller then reports the refusal on its own.
   */
  owner: InstanceRecord | null;
  /** How the holder was found. */
  source: 'lease';
}

/**
 * Thrown when a spawn would write a session another process already owns.
 *
 * Carries the resolved owner so the route can relay the request to the instance
 * that should serve it, instead of only a refusal the client cannot act on.
 */
export class SessionOwnedElsewhereError extends Error {
  readonly sessionId: string;
  readonly ownership: SessionOwnership;

  constructor(sessionId: string, ownership: SessionOwnership) {
    const where = ownership.owner ? ` (Kabmo on port ${ownership.owner.port})` : '';
    super(`This session is being run by another process${where}. Open it there instead of starting a second writer.`);
    this.name = 'SessionOwnedElsewhereError';
    this.sessionId = sessionId;
    this.ownership = ownership;
  }
}

/**
 * Directory holding omp's session ownership leases.
 *
 * Mirrors `getSessionOwnersDir` in `@oh-my-pi/pi-utils/dirs`: the XDG state
 * layout is honored only once its app root already exists, otherwise the
 * leases live under the config root (`~/.omp`, or `PI_CONFIG_DIR`).
 */
export function sessionOwnersDir(): string {
  const xdg = Bun.env.XDG_STATE_HOME;
  if (xdg) {
    const candidate = path.join(xdg, 'omp', 'run', 'session-owners');
    try {
      if (fs.statSync(candidate).isDirectory()) return candidate;
    } catch {
      // Not an XDG install: fall through to the config root.
    }
  }
  return path.join(getConfigRoot(), 'run', 'session-owners');
}

/**
 * Lease filename for a session id.
 *
 * omp keys the lease by the session id from the journal header, and hashes any
 * id that is not a plain token so it cannot name a path outside the directory.
 * Ported verbatim from `tryAcquireSessionLease`, INCLUDING the `.lock` suffix
 * `tryAcquireFileLock` appends: the real file is `<name>.lock`, and a path
 * without the suffix would never exist, so the guard would never fire.
 */
export function sessionLeasePath(sessionId: string): string {
  const name = /^[A-Za-z0-9_-]{1,128}$/.test(sessionId)
    ? sessionId
    : `h-${Bun.hash.wyhash(sessionId).toString(16).padStart(16, '0')}`;
  return path.join(sessionOwnersDir(), `${name}.lock`);
}

/**
 * Who holds `sessionId`, or null when it is free — including when the only
 * holder is THIS process (not a conflict; the local registry already answers).
 *
 * `selfPid` is Kabmo server's own pid: a holder parented by this process
 * is our own child, never a foreign writer.
 */
export async function resolveSessionOwnership(
  sessionId: string,
  selfPid: number = process.pid,
): Promise<SessionOwnership | null> {
  const leasePath = sessionLeasePath(sessionId);
  if (leaseHeldByAnother(leasePath) !== true) return null;

  const holderPid = fileHolderPid(leasePath);
  if (holderPid === null) {
    // Held, but the holder cannot be named (a platform without the fd walk).
    // A real conflict with no instance to relay to.
    return { holderPid: null, owner: null, source: 'lease' };
  }
  if (holderPid === selfPid) return null;

  const parentPid = processParentPid(holderPid);
  // A holder parented by THIS process is our own child — a stale registry
  // entry, not a second instance.
  if (parentPid === selfPid) return null;
  const owner = parentPid === null
    ? null
    : listInstanceRecords().find((record) => record.pid === parentPid && isProcessAlive(record.pid)) ?? null;
  return { holderPid, owner, source: 'lease' };
}

/** True when this session is running somewhere other than this process. */
export async function isSessionOwnedElsewhere(sessionId: string, selfPid: number = process.pid): Promise<boolean> {
  return (await resolveSessionOwnership(sessionId, selfPid)) !== null;
}
