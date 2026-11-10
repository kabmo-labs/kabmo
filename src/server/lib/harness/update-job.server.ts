/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Accepting a harness update: start it now, or queue it behind the install that
 * is already running.
 *
 * The POST that asks for an update answers as soon as the record exists; the
 * worker (`update-worker.ts`) owns the install and writes its progress to disk.
 * This module is the server half of that handshake:
 *
 *  - it refuses a SECOND press for the SAME harness, with the run that caused it;
 *  - it accepts a press for a DIFFERENT harness as a WAITING record, because two
 *    presses is now a queue rather than an error (`update-queue.server.ts` starts
 *    it when the one ahead of it settles);
 *  - and it never runs two workers at once, because both would install into the
 *    same global npm prefix.
 *
 * **The decision is a fact on disk, not a flag in memory.** The old route had no
 * single-flight at all: a page reload mid-install offered the button again, and a
 * second `npm install -g` over the same prefix is how an npm tree gets corrupted.
 * The check reads the same records the worker writes, so a second tab and a
 * second server instance see the same answer.
 */

import { getHarnessUpdateStatusPath } from '@/server/lib/lifecycle/paths';
import { readUpdateJob, settleDeadJob, writeUpdateJob } from '@/server/lib/harness/update-job-store';
import { pumpUpdateQueue, readAllUpdateJobs, serializeUpdateWork } from '@/server/lib/harness/update-queue.server';
import { spawnUpdateWorker } from '@/server/lib/harness/update-spawn.server';
import { jobRunning, jobUnfinished } from '@/shared/lib/harness/update-job';
import type { HarnessUpdateStep } from '@/shared/lib/harness/update-plan';
import type { HarnessId } from '@/shared/lib/harness/catalog';
import type { HarnessUpdateJob } from '@/shared/types/harness-update';

/**
 * This harness's unfinished record — installing, or waiting its turn — or null.
 * Used to refuse a second press with a reason.
 */
export async function unfinishedUpdateJob(harness: HarnessId): Promise<HarnessUpdateJob | null> {
  const path = getHarnessUpdateStatusPath(harness);
  const job = await settleDeadJob(await readUpdateJob(path), path);
  return jobUnfinished(job) ? job : null;
}

/**
 * Start `steps`, or write the record that waits for the install in front of it.
 *
 * Serialized with the queue's own passes: two presses arriving together are one
 * decision, not two "nothing is running" reads that both spawn.
 */
export function startHarnessUpdateJob(
  harness: HarnessId,
  label: string,
  steps: HarnessUpdateStep[],
): Promise<HarnessUpdateJob> {
  return serializeUpdateWork(async () => {
    const busy = (await readAllUpdateJobs()).some(jobRunning);
    const job: HarnessUpdateJob = {
      harness,
      label,
      startedAt: Date.now(),
      finishedAt: null,
      // Set only while this record waits; the spawn clears it.
      queuedAt: busy ? Date.now() : null,
      pid: null,
      steps: steps.map((step) => ({ ...step, state: 'pending', code: null })),
      output: '',
      ok: null,
      message: null,
      applied: false,
      repointed: null,
    };

    if (busy) {
      await writeUpdateJob(job, getHarnessUpdateStatusPath(harness));
      // The ticker starts the queued run when the install ahead of it settles —
      // including with the About card closed. It must not be awaited here.
      void pumpUpdateQueue().catch((cause) => {
        console.error('[harness-update] queue pump failed:', cause);
      });
      return job;
    }

    const started = await spawnUpdateWorker(job);
    // Ticker for the FINALIZE half as well: the side effects a detached worker
    // cannot apply happen without a browser polling this time.
    void pumpUpdateQueue().catch((cause) => {
      console.error('[harness-update] queue pump failed:', cause);
    });
    return started;
  });
}
