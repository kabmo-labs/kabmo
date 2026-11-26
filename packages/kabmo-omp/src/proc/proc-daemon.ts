/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The daemon/service snapshot behind a `proc://` result and a `bash` service
 * launch, read from either generation omp has written.
 *
 * omp 19.0.0 replaced the launch broker's `DaemonSnapshot` — `{name, pid,
 * persist, detached}` — with a daemon unit's `UnitSnapshot` — `{key, label,
 * pids, policy.hold}`. A session recorded before the pin still carries the old
 * fields, so one reader maps both into {@link ProcDaemon}.
 *
 * Split out of `proc.ts` at the repo's per-file ceiling; the job/agent readers
 * and the URL grammar stay there.
 */

import { isRecord } from '@kabmo-labs/kabmo-guards';

export interface ProcDaemon {
  /** The service name: `key` on a 19.0.0 unit, `name` on the broker snapshot older sessions carry. */
  name?: string;
  /** Human label for the board (19.0.0 units only). */
  label?: string;
  id?: string;
  state?: string;
  /** Main process: `pids[0]` on a 19.0.0 unit, `pid` on the broker snapshot. */
  pid?: number;
  createdAt?: number;
  startedAt?: number;
  readyAt?: number;
  exitedAt?: number;
  exitCode?: number;
  restartCount?: number;
  outputBytes?: number;
  readyMatch?: string;
  /** 19.0.0 unit policy: what keeps it alive. */
  hold?: 'leases' | 'persist' | 'detached';
  /** Broker snapshot (pre-19.0.0) lifetime flags. */
  persist?: boolean;
  detached?: boolean;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

/** Normalize a daemon snapshot of either generation. */
export function daemonOf(value: unknown): ProcDaemon | undefined {
  if (!isRecord(value)) return undefined;
  const pids = Array.isArray(value.pids)
    ? value.pids.filter((pid): pid is number => typeof pid === 'number' && Number.isFinite(pid))
    : [];
  const policy = isRecord(value.policy) ? value.policy : undefined;
  const hold = asString(policy?.hold);
  return {
    name: asString(value.key) ?? asString(value.name),
    label: asString(value.label),
    id: asString(value.id),
    state: asString(value.state),
    pid: asNumber(value.pid) ?? pids[0],
    createdAt: asNumber(value.createdAt),
    startedAt: asNumber(value.startedAt),
    readyAt: asNumber(value.readyAt),
    exitedAt: asNumber(value.exitedAt),
    exitCode: asNumber(value.exitCode),
    restartCount: asNumber(value.restartCount),
    outputBytes: asNumber(value.outputBytes),
    readyMatch: asString(value.readyMatch),
    hold: hold === 'leases' || hold === 'persist' || hold === 'detached' ? hold : undefined,
    persist: asBoolean(value.persist) ?? (hold === 'persist' ? true : undefined),
    detached: asBoolean(value.detached) ?? (hold === 'detached' ? true : undefined),
  };
}

/** Tone for a daemon state — omp's own union, mapped to the ink palette. */
export function daemonTone(state: string | undefined): 'ok' | 'warn' | 'error' | 'muted' {
  switch (state) {
    case 'ready':
    case 'running':
      return 'ok';
    case 'failed':
      return 'error';
    case 'starting':
    case 'restarting':
    case 'stopping':
      return 'warn';
    default:
      return 'muted';
  }
}

/** `1h 4m` / `12m 3s` / `840ms` — the scale a service lives on. */
export function formatProcDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m ${totalSeconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/**
 * How long a daemon has been up, or how long it ran before it exited. An
 * exited service's span is `exitedAt - startedAt`, never `now - startedAt` —
 * a service that died an hour ago has not been running for an hour.
 */
export function procUptime(daemon: ProcDaemon, now = Date.now()): { label: string; ms: number } | undefined {
  if (typeof daemon.startedAt !== 'number') return undefined;
  const end = typeof daemon.exitedAt === 'number' ? daemon.exitedAt : now;
  const ms = Math.max(0, end - daemon.startedAt);
  return { label: formatProcDuration(ms), ms };
}
