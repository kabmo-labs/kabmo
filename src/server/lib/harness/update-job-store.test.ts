/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The record a background harness update leaves on disk.
 *
 * The two questions these cases pin are the ones the dialog cannot answer for
 * itself: is this run still going, and is a record that stopped moving a failure
 * rather than something to poll forever.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  jobInFlight,
  pidAlive,
  readUpdateJob,
  settleDeadJob,
  writeUpdateJob,
  UPDATE_START_GRACE_MS,
} from '@/server/lib/harness/update-job-store';
import { jobQueued, jobRunning } from '@/shared/lib/harness/update-job';
import { getHarnessUpdateStatusPath } from '@/server/lib/lifecycle/paths';
import type { HarnessUpdateJob } from '@/shared/types/harness-update';

let dir = '';
let originalDataDir: string | undefined;

beforeEach(() => {
  originalDataDir = Bun.env.KABMO_DATA_DIR;
  dir = mkdtempSync(join(tmpdir(), 'kabmo-update-job-'));
  Bun.env.KABMO_DATA_DIR = dir;
});

afterEach(() => {
  if (originalDataDir === undefined) delete Bun.env.KABMO_DATA_DIR;
  else Bun.env.KABMO_DATA_DIR = originalDataDir;
  rmSync(dir, { recursive: true, force: true });
});

/** The one record this suite owns: claude's own file. */
const statusPath = (): string => getHarnessUpdateStatusPath('claude');

function job(overrides: Partial<HarnessUpdateJob> = {}): HarnessUpdateJob {
  return {
    harness: 'claude',
    label: 'claude',
    startedAt: Date.now(),
    finishedAt: null,
    queuedAt: null,
    pid: process.pid,
    steps: [{ part: 'adapter', command: 'npm install -g x', argv: ['npm', 'install', '-g', 'x'], state: 'running', code: null }],
    output: '',
    ok: null,
    message: null,
    applied: false,
    repointed: null,
    ...overrides,
  };
}

describe('the status record', () => {
  test('round-trips, and leaves no temp file behind', async () => {
    await writeUpdateJob(job({ output: 'installing' }), statusPath());
    const read = await readUpdateJob(statusPath());
    expect(read?.harness).toBe('claude');
    expect(read?.output).toBe('installing');
    // `tmp` + `rename`, so a reader never sees half a record and the temp name
    // does not pile up.
    const leftovers = readdirSync(join(dir, 'run')).filter((name) => name.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
  });

  test('an absent record is null, not a throw', async () => {
    expect(await readUpdateJob(statusPath())).toBeNull();
  });

  test('a foreign JSON file is not a job', async () => {
    // A hand-written or half-written file must read as "nothing ran", not as a
    // record whose missing fields crash the dialog.
    writeFileSync(statusPath(), JSON.stringify({ hello: 'world' }));
    expect(await readUpdateJob(statusPath())).toBeNull();
  });
});

describe('telling a live run from a dead one', () => {
  test('a run with a live pid is in flight', () => {
    expect(jobInFlight(job())).toBe(true);
  });

  test('a finished run is not in flight', () => {
    expect(jobInFlight(job({ finishedAt: Date.now(), ok: true }))).toBe(false);
  });

  test('a run whose worker is gone is settled by the next read', async () => {
    const dead = job({ pid: 99_999_999, startedAt: Date.now() - UPDATE_START_GRACE_MS * 2 });
    await writeUpdateJob(dead, statusPath());
    const settled = await settleDeadJob(await readUpdateJob(statusPath()), statusPath());
    expect(settled?.finishedAt).not.toBeNull();
    expect(settled?.ok).toBe(false);
    expect(settled?.message).toContain('without reporting a result');
    expect(settled?.steps[0].state).toBe('failed');
    // Settled once, and the settle itself is on disk for the next reader.
    expect((await readUpdateJob(statusPath()))?.finishedAt).not.toBeNull();
  });

  test('the start grace covers the pid handshake', async () => {
    // The record is written before the worker has a pid; reading that as dead
    // would report failure over a run that is about to start.
    const starting = job({ pid: null, startedAt: Date.now() });
    await writeUpdateJob(starting, statusPath());
    expect(await settleDeadJob(await readUpdateJob(statusPath()), statusPath())).toEqual(starting);
    expect(jobInFlight(starting)).toBe(true);
  });

  test('a finished run is left exactly as the worker wrote it', async () => {
    const done = job({ pid: null, finishedAt: Date.now(), ok: true, message: 'claude updated (adapter)' });
    await writeUpdateJob(done, statusPath());
    expect(await settleDeadJob(await readUpdateJob(statusPath()), statusPath())).toEqual(done);
  });

  test('a QUEUED record is neither in flight nor dead', async () => {
    // Two presses are a queue: the second record exists with no pid on purpose,
    // and reading that as a worker that died would fail a run that never started.
    const waiting = job({ pid: null, queuedAt: Date.now() - UPDATE_START_GRACE_MS * 2 });
    await writeUpdateJob(waiting, statusPath());
    expect(jobQueued(waiting)).toBe(true);
    expect(jobRunning(waiting)).toBe(false);
    expect(jobInFlight(waiting)).toBe(false);
    expect(await settleDeadJob(await readUpdateJob(statusPath()), statusPath())).toEqual(waiting);
  });

  test('a queued record starts reading as a RUN when its worker takes over', async () => {
    const started = job({ pid: process.pid, queuedAt: Date.now() });
    await writeUpdateJob(started, statusPath());
    // The pid, not the stamp, is what makes it a run: the worker writes both.
    expect(jobQueued(started)).toBe(false);
    expect(jobRunning(started)).toBe(true);
    expect(jobInFlight(started)).toBe(true);
  });

  test('an impossible pid is not alive', () => {
    expect(pidAlive(null)).toBe(false);
    expect(pidAlive(0)).toBe(false);
    expect(pidAlive(process.pid)).toBe(true);
  });
});
