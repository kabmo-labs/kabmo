/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The per-port instance record: who is serving this port, in what mode, since
 * when.
 *
 * Written by the server that owns the port (not by the CLI that happened to
 * spawn it), so a server started by `bun run dev`, by `--foreground`, or by the
 * daemon path is discoverable the same way. Writes are best-effort: a read-only
 * data directory must degrade `status` to a probe, never take the server down.
 */

import fs from 'fs';

import { getInstancePath, getRunDir } from '@/server/lib/lifecycle/paths';

export type InstanceMode = 'dev' | 'prod';
export type InstanceLaunchMode = 'daemon' | 'foreground' | 'direct';

export interface InstanceRecord {
  pid: number;
  port: number;
  host: string;
  mode: InstanceMode;
  launchMode: InstanceLaunchMode;
  /**
   * Whether this run was started with `--tray`.
   *
   * Recorded because a replacement is spawned from the CLI's OWN argv, which
   * carries none of the flags the original run had: `restart` builds its
   * `serve` invocation from the command line of `ompchamber restart`, so a
   * server started with `--tray` (a login entry, `serve --tray`) came back
   * without an icon after every update. The record is the only description of
   * the instance that survives the process, so the flags live here.
   */
  tray: boolean;
  /** Whether this run serves TLS (`--tls`). Lost the same way `tray` was. */
  tls: boolean;
  /**
   * Whether this run requires a UI password.
   *
   * Recorded so a restart that CANNOT reproduce the credential says so instead
   * of quietly starting an open server. The plaintext is never stored (only a
   * hash lives in memory), so a manual `ompchamber restart` genuinely cannot
   * recover it — the replacement has to be told, not guessed at.
   */
  auth: boolean;
  startedAt: string;
  version: string;
}

function isLaunchMode(value: unknown): value is InstanceLaunchMode {
  return value === 'daemon' || value === 'foreground' || value === 'direct';
}

/** Record for `port`, or null when absent or unreadable. */
export function readInstanceRecord(port: number | string): InstanceRecord | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(getInstancePath(port), 'utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.pid !== 'number' || typeof record.port !== 'number') return null;
    return {
      pid: record.pid,
      port: record.port,
      host: typeof record.host === 'string' ? record.host : 'localhost',
      mode: record.mode === 'prod' ? 'prod' : 'dev',
      launchMode: isLaunchMode(record.launchMode) ? record.launchMode : 'direct',
      // Absent on a record written before these fields existed. `false` is the
      // honest answer there: an instance whose flags nobody recorded is not
      // known to have had an icon or TLS, and re-adding either would be a
      // guess about how the user started it.
      tray: record.tray === true,
      tls: record.tls === true,
      auth: record.auth === true,
      startedAt: typeof record.startedAt === 'string' ? record.startedAt : '',
      version: typeof record.version === 'string' ? record.version : '',
    };
  } catch {
    return null;
  }
}

/** Every readable record in the run directory. */
export function listInstanceRecords(): InstanceRecord[] {
  const records: InstanceRecord[] = [];
  try {
    for (const file of fs.readdirSync(getRunDir())) {
      const match = /^(\d+)\.json$/.exec(file);
      if (!match) continue;
      const record = readInstanceRecord(match[1]);
      if (record) records.push(record);
    }
  } catch {
    // No run directory yet: nothing has ever been served.
  }
  return records;
}

/**
 * Persist the record for its port (sibling temp file + rename, mode 0600).
 * Returns false instead of throwing when the data directory is not writable.
 */
export function writeInstanceRecord(record: InstanceRecord): boolean {
  const target = getInstancePath(record.port);
  const temp = `${target}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(record, null, 2), { mode: 0o600 });
    fs.renameSync(temp, target);
    return true;
  } catch {
    try {
      fs.rmSync(temp, { force: true });
    } catch {
      // Best-effort cleanup only.
    }
    return false;
  }
}

/** Drop the record for `port`. Never throws. */
export function removeInstanceRecord(port: number | string): void {
  try {
    fs.rmSync(getInstancePath(port), { force: true });
  } catch {
    // Best-effort: a stale record is detected by PID identity on the next read.
  }
}
