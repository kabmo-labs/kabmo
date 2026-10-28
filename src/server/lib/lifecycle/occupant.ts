/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Who is serving a port right now.
 *
 * Two independent sources answer that question, and they are deliberately
 * combined: the instance record (written by the server itself) and the live
 * `/api/health` probe. The record is the only source for a port whose server is
 * deaf (hung, suspended, still starting), while the probe is the only source
 * for a server started outside the CLI — a `bun run dev` server must be
 * discoverable, and before this module it was invisible to every CLI command.
 */

import { getProcessState, isProcessAlive } from '@/server/lib/lifecycle/identity';
import { readInstanceRecord } from '@/server/lib/lifecycle/instance';
import { fetchHealth } from '@/server/lib/lifecycle/probe';

export interface Occupant {
  pid: number;
  port: number;
  host?: string;
  version?: string;
  /** `dev` | `prod` as reported by the live server, else from the record. */
  mode?: string;
  launchMode?: string;
  startedAt?: string;
  uptime?: number;
  source: 'registry+probe' | 'probe' | 'registry';
  /** True when the occupant answered `/api/health` as Kabmo itself. */
  confirmedByHealth: boolean;
}

/** The Kabmo instance on `port`, or null when the port is free/foreign. */
export async function findOccupant(port: number, host?: string | null): Promise<Occupant | null> {
  const record = readInstanceRecord(port);
  const recordIsLive = record !== null
    && isProcessAlive(record.pid)
    && getProcessState(record.pid) !== 'mismatched';

  const health = await fetchHealth(port, record?.host ?? host);
  const healthPid = health?.pid;
  if (health && typeof healthPid === 'number' && isProcessAlive(healthPid)) {
    return {
      pid: healthPid,
      port,
      host: record?.host ?? host ?? undefined,
      version: health.version ?? record?.version,
      mode: health.mode ?? record?.mode,
      launchMode: record?.launchMode,
      startedAt: health.startedAt ?? record?.startedAt,
      uptime: health.uptime,
      source: recordIsLive && record.pid === healthPid ? 'registry+probe' : 'probe',
      confirmedByHealth: true,
    };
  }

  if (record && recordIsLive) {
    return {
      pid: record.pid,
      port,
      host: record.host,
      version: record.version,
      mode: record.mode,
      launchMode: record.launchMode,
      startedAt: record.startedAt,
      source: 'registry',
      confirmedByHealth: false,
    };
  }

  return null;
}

/** One-line identity for logs and errors: `pid 1234 (dev, direct, v0.5.0, up 2m)`. */
export function describeOccupant(occupant: Occupant): string {
  const details: string[] = [];
  if (occupant.mode) details.push(occupant.mode);
  if (occupant.launchMode) details.push(occupant.launchMode);
  if (occupant.version) details.push(`v${occupant.version}`);
  const age = occupantAge(occupant);
  if (age) details.push(`up ${age}`);
  if (!occupant.confirmedByHealth) details.push('unconfirmed');
  const suffix = details.length > 0 ? ` (${details.join(', ')})` : '';
  return `pid ${occupant.pid}${suffix}`;
}

function occupantAge(occupant: Occupant): string | null {
  const seconds = typeof occupant.uptime === 'number'
    ? Math.round(occupant.uptime)
    : occupant.startedAt
      ? Math.round((Date.now() - Date.parse(occupant.startedAt)) / 1000)
      : Number.NaN;
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
