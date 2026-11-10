/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Two harnesses, one install at a time.
 *
 * The press for a second harness used to be refused outright while the first
 * installed — "update these two" was impossible without waiting and pressing
 * again. It is now ACCEPTED as a waiting record, and this suite pins the three
 * properties that make that safe rather than a second concurrent `npm install -g`
 * over the same prefix:
 *
 *  - the refusal is per HARNESS (the same harness is still a `409`);
 *  - a press while another installs W R I T E S a waiting record and starts
 *    nothing;
 *  - the queue starts the OLDEST waiting record, and only when nothing runs.
 *
 * The last case spawns the real worker, because that is the thing being tested:
 * a detached install nobody awaits finishing on its own.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  nextQueuedJob,
  pumpUpdateQueue,
  readAllUpdateJobs,
} from '@/server/lib/harness/update-queue.server';
import { startHarnessUpdateJob, unfinishedUpdateJob } from '@/server/lib/harness/update-job.server';
import { readUpdateJob, writeUpdateJob } from '@/server/lib/harness/update-job-store';
import { getHarnessUpdateStatusPath } from '@/server/lib/lifecycle/paths';
import { jobQueued, jobRunning } from '@/shared/lib/harness/update-job';
import { UNPROBED_CAPABILITIES, type HarnessProbe } from '@/server/lib/harness/capabilities';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { describePosix } from '@/test-support/platform';
import type { HarnessUpdateStep } from '@/shared/lib/harness/update-plan';
import type { HarnessUpdateJob } from '@/shared/types/harness-update';

let dir = '';
let originalDataDir: string | undefined;

beforeEach(async () => {
  originalDataDir = Bun.env.KABMO_DATA_DIR;
  dir = mkdtempSync(join(tmpdir(), 'kabmo-update-queue-'));
  Bun.env.KABMO_DATA_DIR = dir;
  // The queue applies a finished run's side effects, and those read the
  // harness config from the database: never the developer's own file.
  await isolateDb();
});

afterEach(async () => {
  await releaseDb();
  if (originalDataDir === undefined) delete Bun.env.KABMO_DATA_DIR;
  else Bun.env.KABMO_DATA_DIR = originalDataDir;
  rmSync(dir, { recursive: true, force: true });
});

function job(overrides: Partial<HarnessUpdateJob> = {}): HarnessUpdateJob {
  return {
    harness: 'claude',
    label: 'claude',
    startedAt: Date.now(),
    finishedAt: null,
    queuedAt: null,
    pid: process.pid,
    steps: [{ part: 'adapter', command: 'npm install -g x', argv: ['npm', 'install', '-g', 'x'], state: 'pending', code: null }],
    output: '',
    ok: null,
    message: null,
    applied: false,
    repointed: null,
    ...overrides,
  };
}

/** A probe answer, without spawning an agent. */
function probeAnswer(harness: string, agentVersion: string | null): HarnessProbe {
  return {
    harness,
    capabilities: { ...UNPROBED_CAPABILITIES, ...(agentVersion ? { agentVersion } : {}) },
    models: [],
    thinking: [],
    modes: [],
    probedAt: Date.now(),
  };
}

/** Wait for a record to reach a condition. No external process is involved, so
 *  this settles in milliseconds — it exists because the probe write is the LAST
 *  step of a background task the queue deliberately does not await. */
async function until(
  harness: string,
  condition: (job: HarnessUpdateJob | null) => boolean,
): Promise<HarnessUpdateJob | null> {
  let job = await readUpdateJob(getHarnessUpdateStatusPath(harness));
  for (let attempt = 0; attempt < 200 && !condition(job); attempt += 1) {
    await Bun.sleep(5);
    job = await readUpdateJob(getHarnessUpdateStatusPath(harness));
  }
  return job;
}

/** A step that does nothing, for the cases that only care about the handover. */
function noopStep(): HarnessUpdateStep {
  return {
    part: 'adapter',
    command: `${process.execPath} -e process.exit(0)`,
    argv: [process.execPath, '-e', 'process.exit(0)'],
  };
}

describe('the refusal is per harness', () => {
  test('the harness that is installing is refused, another one is accepted', async () => {
    await writeUpdateJob(job(), getHarnessUpdateStatusPath('claude'));

    expect((await unfinishedUpdateJob('claude'))?.harness).toBe('claude');
    // Null is what makes the route accept a press for codex instead of a 409.
    expect(await unfinishedUpdateJob('codex')).toBeNull();
  });

  test('a press while another harness installs waits, and starts nothing', async () => {
    await writeUpdateJob(job(), getHarnessUpdateStatusPath('claude'));

    const waiting = await startHarnessUpdateJob('codex', 'codex', [noopStep()]);

    expect(jobQueued(waiting)).toBe(true);
    expect(waiting.pid).toBeNull();
    expect(waiting.queuedAt).toBeNumber();
    // The record is on disk, because the dialog reads it from there.
    const stored = await readUpdateJob(getHarnessUpdateStatusPath('codex'));
    expect(jobQueued(stored)).toBe(true);
    // …and the install in front of it was not disturbed.
    const claude = await readUpdateJob(getHarnessUpdateStatusPath('claude'));
    expect(jobRunning(claude)).toBe(true);
  });
});

describe('the post-install probe', () => {
  test('a settled run reports `pending` while the agent is being asked, then `done`', async () => {
    const { promise, resolve } = Promise.withResolvers<HarnessProbe>();
    let asked = 0;
    await writeUpdateJob(job({
      pid: null,
      finishedAt: Date.now(),
      ok: true,
      applied: false,
      message: 'claude updated (adapter)',
      steps: [noopStep()].map((step) => ({ ...step, state: 'ok', code: 0 })),
    }), getHarnessUpdateStatusPath('claude'));

    const jobs = await pumpUpdateQueue({
      probe: () => { asked += 1; return promise; },
    });
    // The install's own report is not held up by the probe: the record answers
    // immediately, with the probe marked so a dialog keeps polling.
    expect(jobs.find((entry) => entry.harness === 'claude')?.probe).toBe('pending');
    expect(asked).toBe(1);

    resolve(probeAnswer('claude', '0.103.0'));
    const done = await until('claude', (job) => job?.probe === 'done');
    expect(done?.probe).toBe('done');
    expect(done?.message).toContain('it now reports 0.103.0');
    // Asked once, even though every pass re-kicks a record that still says
    // `pending`: a probe is an agent process, not a cheap read.
    await pumpUpdateQueue({ probe: () => { asked += 1; return promise; } });
    expect(asked).toBe(1);
  });

  test('a FAILED run is not probed, and says nothing about a version', async () => {
    await writeUpdateJob(job({
      pid: null,
      finishedAt: Date.now(),
      ok: false,
      applied: false,
      message: 'claude update failed (exit 1)',
      steps: [noopStep()].map((step) => ({ ...step, state: 'failed', code: 1 })),
    }), getHarnessUpdateStatusPath('claude'));

    let asked = 0;
    await pumpUpdateQueue({ probe: async (id) => { asked += 1; return probeAnswer(id, null); } });
    const record = await readUpdateJob(getHarnessUpdateStatusPath('claude'));
    expect(asked).toBe(0);
    expect(record?.probe).toBeNull();
    expect(record?.message).toBe('claude update failed (exit 1)');
  });
});

describe('the queue', () => {
  test('the oldest waiting record goes next', () => {
    const older = job({ harness: 'codex', label: 'codex', pid: null, queuedAt: 1_000 });
    const newer = job({ harness: 'pi', label: 'pi', pid: null, queuedAt: 2_000 });
    const done = job({ harness: 'opencode', label: 'opencode', pid: null, finishedAt: Date.now() });

    expect(nextQueuedJob([newer, done, older])?.harness).toBe('codex');
    expect(nextQueuedJob([done])).toBeNull();
  });

  test('records are read per harness: one file each, nothing shared', async () => {
    await writeUpdateJob(job(), getHarnessUpdateStatusPath('claude'));
    await writeUpdateJob(job({ harness: 'codex', label: 'codex', pid: null, queuedAt: Date.now() }), getHarnessUpdateStatusPath('codex'));

    const jobs = await readAllUpdateJobs();
    expect(jobs.map((entry) => entry.harness).sort()).toEqual(['claude', 'codex']);
  });

  describePosix('starting the waiting run once the install ahead settles', () => {
    test('a waiting codex run is handed to a worker after claude finishes', async () => {
      // Claude's run is over; its record has not been finalized yet.
      await writeUpdateJob(job({
        pid: null,
        finishedAt: Date.now(),
        ok: true,
        applied: true,
        message: 'claude updated (adapter)',
      }), getHarnessUpdateStatusPath('claude'));
      await writeUpdateJob(
        job({
          harness: 'codex',
          label: 'codex',
          pid: null,
          queuedAt: Date.now(),
          steps: [noopStep()].map((step) => ({ ...step, state: 'pending', code: null })),
        }),
        getHarnessUpdateStatusPath('codex'),
      );

      const probed: string[] = [];
      const jobs = await pumpUpdateQueue({
        probe: async (id) => { probed.push(id); return probeAnswer(id, '0.2.0'); },
      });
      const codex = jobs.find((entry) => entry.harness === 'codex');
      // Handed over: a worker owns it now, so it is no longer waiting.
      expect(codex?.queuedAt).toBeNull();
      expect(codex?.pid).toBeNumber();

      // The worker is a DETACHED process with no handle to await, so the only
      // way to observe the install finishing is its own record. Bounded, and the
      // step is a no-op that exits immediately.
      let settled: HarnessUpdateJob | null = null;
      for (let attempt = 0; attempt < 200; attempt += 1) {
        settled = await readUpdateJob(getHarnessUpdateStatusPath('codex'));
        if (settled?.finishedAt != null) break;
        await Bun.sleep(25);
      }
      expect(settled?.finishedAt).not.toBeNull();
      expect(settled?.ok).toBe(true);

      // The worker finishing is not the queue moving: the next pass — the
      // ticker in production — applies the side effects and probes the binary it
      // just installed. A successful run is not finished with the READER until
      // that answer lands, or the row keeps quoting the replaced version.
      await pumpUpdateQueue({ probe: async (id) => { probed.push(id); return probeAnswer(id, '0.2.0'); } });
      const afterProbe = await until('codex', (job) => job?.probe === 'done');
      expect(probed).toEqual(['codex']);
      expect(afterProbe?.message).toContain('it now reports 0.2.0');
      // Nothing is moving now, so one more pass applies what is left and stops
      // the ticker the queue started — inside this test's isolated DB.
      await pumpUpdateQueue({ probe: async (id) => probeAnswer(id, null) });
    });
  });
});
