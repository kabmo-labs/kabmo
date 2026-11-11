/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The lease Kabmo writes for every live ACP child, and what it says.
 *
 * An ACP agent holds no omp session lease: its id lives in Kabmo's
 * `harness_sessions` table and its transcript lives behind the agent. Without
 * this file the panel can only read argv, so every `claude`/`codex`/`opencode`
 * chat was drawn as a bare `npx` row inside Kabmo's own group — measured
 * against the real launch table, 12 of the 13 ACP harnesses.
 *
 * The writer is `src/server/lib/harness/session-lease.server.ts`; the shape is
 * restated here for the same reason `sessions.ts` restates omp's paths: a
 * plugin is bundled into the host and cannot import Kabmo's own `@/` modules.
 * The two must agree on the field names, and the reader is deliberately strict
 * — a malformed record is dropped rather than rendered as a half-named row.
 *
 * `startedAt` is the process's spawn time, not the write time. The sampler
 * compares it with the probe's own start time so a recycled pid cannot be
 * named after a chat that no longer exists.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** What the lease says the child is doing. */
export type HarnessLeaseState = 'starting' | 'session' | 'prewarm';

/** The facts a group and a label need, without the pid bookkeeping. */
export interface SessionLease {
  /** Kabmo's session id, empty until the handshake answers. */
  sessionId: string;
  harness: string;
  /** The catalog's display label (`claude`, `omp (ACP)`, …). */
  label: string;
  /** The chat's name, empty until the first prompt or the agent names it. */
  title: string;
  state: HarnessLeaseState;
  cwd: string;
}

/** One live ACP child, as the host wrote it. */
export interface HarnessLease extends SessionLease {
  pid: number;
  /** The process's spawn time (epoch ms), for the pid-reuse guard. */
  startedAt: number;
}

/**
 * Kabmo's data root, resolved the way `lifecycle/paths.ts` resolves it.
 *
 * `KABMO_DATA_DIR` is the override the server itself honours; the legacy
 * `OMPCHAMBER_DATA_DIR` is still read for an install whose unit file exports
 * it. `os.homedir()` rather than `HOME`, because a process started without a
 * shell has no `HOME` and an empty value would move the directory to a
 * cwd-relative path.
 */
function kabmoDataDir(): string {
  const override = (Bun.env.KABMO_DATA_DIR ?? Bun.env.OMPCHAMBER_DATA_DIR ?? '').trim();
  if (override) {
    return path.resolve(override.startsWith('~') ? path.join(os.homedir(), override.slice(1)) : override);
  }
  return path.join(os.homedir(), '.kabmo');
}

/** `<data>/run/harness-sessions` — where the host writes one file per child. */
export function harnessLeasesDir(): string {
  return path.join(kabmoDataDir(), 'run', 'harness-sessions');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

/** One parsed record, or null when a field the panel relies on is missing. */
function leaseOf(value: unknown): HarnessLease | null {
  const record = asRecord(value);
  if (!record) return null;
  const pid = record.pid;
  const startedAt = record.startedAt;
  const state = record.state;
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return null;
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return null;
  if (state !== 'starting' && state !== 'session' && state !== 'prewarm') return null;
  if (typeof record.harness !== 'string' || !record.harness) return null;
  if (typeof record.label !== 'string' || !record.label) return null;
  return {
    pid,
    startedAt,
    state,
    harness: record.harness,
    label: record.label,
    sessionId: typeof record.sessionId === 'string' ? record.sessionId : '',
    title: typeof record.title === 'string' ? record.title : '',
    cwd: typeof record.cwd === 'string' ? record.cwd : '',
  };
}

/**
 * Every lease the host has written, by pid.
 *
 * A missing directory is an empty map, not an error: a host that has never
 * spawned an ACP chat has nothing to say, and the panel must still draw the
 * omp rows it can measure.
 */
export function readHarnessLeases(dir = harnessLeasesDir()): Map<number, HarnessLease> {
  const out = new Map<number, HarnessLease>();
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    } catch {
      // A half-written file is a lease we do not have; the next sample reads
      // the renamed one.
      continue;
    }
    const lease = leaseOf(raw);
    if (lease) out.set(lease.pid, lease);
  }
  return out;
}
