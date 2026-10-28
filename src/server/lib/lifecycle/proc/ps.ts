/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `ps` fallback for POSIX platforms without a native probe (the BSDs).
 *
 * Kept because it is the only mechanism left that works everywhere a `ps` is
 * installed, and because dropping it would make identity worse on those
 * platforms than it was before the native probes existed. macOS and Linux no
 * longer reach this path.
 *
 * The whole table is read once and cached briefly: every question in a port
 * check happens within milliseconds, so one snapshot answers all of them.
 */

import { spawnSync } from 'bun';

import type { ProcessProbe } from '@/server/lib/lifecycle/proc/types';

interface ProcessRow {
  pid: number;
  /** `ps` state column — `Z…` means defunct (exited, awaiting reaping). */
  state: string;
  command: string;
}

const TABLE_MAX_AGE_MS = 250;
let cached: { at: number; rows: ProcessRow[] } | null = null;

function processTable(): ProcessRow[] {
  if (cached && Date.now() - cached.at < TABLE_MAX_AGE_MS) return cached.rows;
  const rows: ProcessRow[] = [];
  try {
    const snapshot = spawnSync({
      cmd: ['ps', '-ax', '-o', 'pid=,stat=,command='],
      stdout: 'pipe',
      stderr: 'ignore',
    });
    if (snapshot.success) {
      for (const line of snapshot.stdout.toString().split('\n')) {
        const match = /^\s*(\d+)\s+(\S+)\s+(.*)$/.exec(line);
        if (!match) continue;
        rows.push({ pid: Number(match[1]), state: match[2], command: match[3].trim() });
      }
    }
  } catch {
    // No `ps` on PATH: every question degrades to "unknown".
  }
  cached = { at: Date.now(), rows };
  return rows;
}

function signalAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the PID exists, we may not signal it.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export const psProbe: ProcessProbe = {
  commandLine(pid) {
    const row = processTable().find((entry) => entry.pid === pid);
    return row && row.command.length > 0 ? row.command : null;
  },
  liveness(pid) {
    // The table already carries the state column, so liveness and zombie-ness
    // are one lookup; the signal check stays for the no-`ps` case.
    const row = processTable().find((entry) => entry.pid === pid);
    if (row) return row.state.startsWith('Z') ? 'zombie' : 'alive';
    return signalAlive(pid) ? 'unknown' : 'dead';
  },
  isAlive(pid) {
    if (!signalAlive(pid)) return false;
    const row = processTable().find((entry) => entry.pid === pid);
    // Absent from the table means no `ps` (or a race) — liveness stands.
    return row ? !row.state.startsWith('Z') : true;
  },
  isZombie(pid) {
    const row = processTable().find((entry) => entry.pid === pid);
    return row ? row.state.startsWith('Z') : false;
  },
  foregroundGroup() {
    // The cached table has no `tpgid` column, and adding one would make every
    // question pay for a field only this one asks. Null keeps the caller on its
    // own `ps -o pid=,tpgid=` path, which is where the BSDs were anyway.
    return null;
  },
  parentPid(pid) {
    // The cached table carries no ppid column for the same reason it carries no
    // tpgid; the caller falls back to its own `ps -o ppid=`.
    void pid;
    return null;
  },
};
