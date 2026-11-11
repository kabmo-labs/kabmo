/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The per-pid lease that tells the Stats panel which chat an ACP child is.
 *
 * omp's RPC hosts hold an OS `flock` on `~/.omp/run/session-owners/<id>.lock`,
 * and the panel reads that descriptor to name a session. An ACP agent holds no
 * such lease: its id lives in Kabmo's `harness_sessions` table and its
 * transcript lives behind the agent, so a panel that only knew argv drew every
 * `claude`/`codex`/`opencode` chat as a bare `npx` row inside Kabmo's own group
 * — measured against the real launch table, 12 of the 13 ACP harnesses.
 *
 * This file is the missing fact, written by the process that owns it:
 * `<data>/run/harness-sessions/<pid>.json`, one record per live ACP child.
 *
 * Three details are load-bearing:
 *
 *  - **`startedAt` is the process's spawn time, not the write time.** The first
 *    write happens immediately after the spawn, so a reader can reject a
 *    recycled pid instead of naming a stranger's process after a chat. A
 *    claimed prewarm keeps the prewarm's `startedAt`, because the process did
 *    not restart when the chat adopted it.
 *  - **The record is a FILE, not a database row.** The reader is a plugin: its
 *    server half runs in this process but has no database handle, and opening a
 *    second one is forbidden. A file is the same channel omp's own lease and
 *    daemon registry already use.
 *  - **A write is atomic.** The panel samples once a second and may read while
 *    a title is being updated; a half-written JSON would drop the row back to
 *    `npx` for one tick.
 */

import fs from 'node:fs';

import { getHarnessLeaseDir, getHarnessLeasePath } from '@/server/lib/lifecycle/paths';
import { harnessDescriptor, type HarnessId } from '@/shared/lib/harness/catalog';

/** What the lease says the child is doing. */
export type HarnessLeaseState = 'starting' | 'session' | 'prewarm';

/** One live ACP child, as the Stats panel reads it. */
export interface HarnessLeaseRecord {
  pid: number;
  /** Kabmo's session id, empty until the handshake answers. */
  sessionId: string;
  harness: string;
  /** The catalog's display label, so the panel needs no second table. */
  label: string;
  cwd: string;
  state: HarnessLeaseState;
  /** The process's spawn time (epoch ms), for the pid-reuse guard. */
  startedAt: number;
  /** The chat's name, empty until the first prompt or the agent names it. */
  title: string;
}

declare global {
  // eslint-disable-next-line no-var
  var __kabmoHarnessLeases: Map<string, number> | undefined;
}

/** session id → pid, so a title update can find the file to rewrite. */
function bySession(): Map<string, number> {
  globalThis.__kabmoHarnessLeases ??= new Map();
  return globalThis.__kabmoHarnessLeases;
}

function readLease(pid: number): HarnessLeaseRecord | null {
  try {
    const raw = JSON.parse(fs.readFileSync(getHarnessLeasePath(pid), 'utf8')) as unknown;
    return raw && typeof raw === 'object' ? (raw as HarnessLeaseRecord) : null;
  } catch {
    // A missing or half-written file is a lease we do not have, which is the
    // same outcome as a child that is not running.
    return null;
  }
}

function writeLease(record: HarnessLeaseRecord): void {
  const file = getHarnessLeasePath(record.pid);
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(record), { mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch (error) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // The rename is what failed; a leftover temp file is pruned at boot.
    }
    console.error(`[harness] could not write the session lease for pid ${record.pid}:`, error);
  }
}

/**
 * Record (or update) the lease for one ACP child.
 *
 * Called twice per cold spawn — `starting` right after the process exists, then
 * `session` once the handshake answers — and once per prewarm. A second call
 * preserves the first call's `startedAt`, which is what makes the pid-reuse
 * guard work for a prewarm claimed minutes later.
 */
export function noteHarnessLease(input: {
  pid: number;
  harness: HarnessId;
  cwd: string;
  state: HarnessLeaseState;
  sessionId?: string;
  title?: string;
}): void {
  if (!Number.isInteger(input.pid) || input.pid <= 0) return;
  const existing = readLease(input.pid);
  const record: HarnessLeaseRecord = {
    pid: input.pid,
    sessionId: input.sessionId ?? existing?.sessionId ?? '',
    harness: input.harness,
    label: harnessDescriptor(input.harness)?.label ?? input.harness,
    cwd: input.cwd,
    state: input.state,
    startedAt: existing?.startedAt ?? Date.now(),
    title: input.title ?? existing?.title ?? '',
  };
  writeLease(record);
  if (record.sessionId) bySession().set(record.sessionId, record.pid);
}

/**
 * Rewrite the title of the lease that owns `sessionId`.
 *
 * A no-op for a session with no lease (an omp RPC chat, whose title lives in
 * its transcript) and for a title that arrives before the spawn wrote one.
 */
export function updateHarnessLeaseTitle(sessionId: string, title: string): void {
  const pid = bySession().get(sessionId);
  if (!pid) return;
  const record = readLease(pid);
  if (!record) return;
  writeLease({ ...record, title });
}

/** Forget one child: its process is gone, so its lease must not outlive it. */
export function removeHarnessLease(pid: number): void {
  const record = readLease(pid);
  if (record?.sessionId) bySession().delete(record.sessionId);
  try {
    fs.rmSync(getHarnessLeasePath(pid), { force: true });
  } catch {
    // A lease that cannot be removed is pruned at the next boot.
  }
}

/** Whether a pid is still a live process (EPERM means it exists, owned by another user). */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Drop the leases a crashed server left behind.
 *
 * The panel ignores a lease whose pid is not in its sweep, so a stale file is
 * harmless to read — but one file per session ever spawned is unbounded growth,
 * and a recycled pid is exactly what the `startedAt` guard exists to survive.
 * Called once at boot, before any session can write a new one.
 */
export function pruneHarnessLeases(): number {
  let names: string[];
  try {
    names = fs.readdirSync(getHarnessLeaseDir());
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of names) {
    const match = /^(\d+)\.json$/.exec(name);
    if (!match) continue;
    const pid = Number(match[1]);
    if (isAlive(pid)) continue;
    try {
      fs.rmSync(getHarnessLeasePath(pid), { force: true });
      removed += 1;
    } catch {
      // Another process may be pruning the same directory; the next boot retries.
    }
  }
  return removed;
}
