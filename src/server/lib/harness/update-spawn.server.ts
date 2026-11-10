/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Spawning the detached worker that installs one harness update, and returning
 * the record it will fill.
 *
 * Its own module because two callers start a run and neither may own the other:
 * the update route, when nothing else is installing, and the queue, when the run
 * ahead of a waiting one has finished. Both go through here, so the record and
 * the spec are written in the same order in both places:
 *
 *  1. the spec (what to run) — the worker reads it, never the record's steps;
 *  2. the record with `pid: null` — a poll arriving in between sees "running"
 *     rather than "no update", and the start grace covers the gap;
 *  3. the record with the pid, immediately after the spawn.
 *
 * The worker is DETACHED and never adopted: it has to survive a server exit.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolveBunBin } from '@/server/lib/lifecycle/bun';
import { packageDir } from '@/server/lib/fs/package-root';
import { getHarnessUpdateLockPath, getHarnessUpdateSpecPath, getHarnessUpdateStatusPath } from '@/server/lib/lifecycle/paths';
import { writeUpdateJob } from '@/server/lib/harness/update-job-store';
import type { HarnessUpdateJob, HarnessUpdateJobSpec } from '@/shared/types/harness-update';

/**
 * Where the worker's source lives inside this package.
 *
 * Derived from the package root rather than `import.meta.dir`: in production the
 * server runs the AOT bundle in `dist/client`, so this module's own directory is
 * not the source tree. `src/` ships in the tarball (`package.json#files`), which
 * is what makes the path valid in an installed copy too.
 */
function workerPath(): string {
  return join(packageDir(), 'src', 'server', 'lib', 'harness', 'update-worker.ts');
}

/**
 * Start the worker for `job`'s steps and return the record it will fill.
 *
 * `job` may be a record that was WAITING (the queue hands it over): the run's
 * clock starts here, and `queuedAt` is cleared because the wait is over.
 */
export async function spawnUpdateWorker(job: HarnessUpdateJob): Promise<HarnessUpdateJob> {
  const worker = workerPath();
  if (!existsSync(worker)) {
    throw new Error(`The update worker is missing from ${worker} — reinstall Kabmo to restore it`);
  }

  const spec: HarnessUpdateJobSpec = {
    harness: job.harness,
    label: job.label,
    steps: job.steps,
    statusPath: getHarnessUpdateStatusPath(job.harness),
    lockPath: getHarnessUpdateLockPath(),
  };
  await Bun.write(getHarnessUpdateSpecPath(job.harness), JSON.stringify(spec, null, 2));

  const running: HarnessUpdateJob = {
    ...job,
    startedAt: Date.now(),
    finishedAt: null,
    pid: null,
    queuedAt: null,
    steps: job.steps.map((step) => ({ ...step, state: 'pending', code: null })),
    output: '',
    ok: null,
    message: null,
    applied: false,
    repointed: null,
  };
  await writeUpdateJob(running, spec.statusPath);

  const child = Bun.spawn({
    cmd: [resolveBunBin(), worker, getHarnessUpdateSpecPath(job.harness)],
    cwd: packageDir(),
    stdin: 'ignore',
    // Nothing is read back from stdio: the worker reports through the record, so
    // the install cannot be wedged by a parent that stopped draining a pipe.
    stdout: 'ignore',
    stderr: 'ignore',
    detached: true,
  });
  // Never adopted by this process: the worker has to survive a server exit, and
  // `unref` is what keeps the event loop from waiting on it.
  child.unref();

  const started: HarnessUpdateJob = { ...running, pid: child.pid ?? null };
  await writeUpdateJob(started, spec.statusPath);
  return started;
}
