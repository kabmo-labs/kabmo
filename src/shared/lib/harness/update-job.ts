/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Reading a harness-update record that came from somewhere else, and the three
 * questions every reader asks of one: is it waiting, is it running, and which
 * step is it on.
 *
 * Two readers get one over the wire or off disk — the About card, which parses
 * the status response, and the server, which parses the files a detached worker
 * wrote — and neither may assume the shape: a half-written file or an older
 * build's payload would otherwise reach `job.steps.find(...)` and throw inside a
 * render. The guard IS the check, so a payload that fails it reads as "no run".
 */

import type { HarnessUpdateJob } from '@/shared/types/harness-update';

export function isHarnessUpdateJob(value: unknown): value is HarnessUpdateJob {
  if (!value || typeof value !== 'object') return false;
  const job = value as Partial<HarnessUpdateJob>;
  return typeof job.harness === 'string'
    && typeof job.label === 'string'
    && typeof job.startedAt === 'number'
    && Array.isArray(job.steps)
    && (job.finishedAt === null || typeof job.finishedAt === 'number');
}

/** The `job` field of a refusal payload, or null when it is not a record. */
export function updateJobFrom(payload: unknown): HarnessUpdateJob | null {
  if (!payload || typeof payload !== 'object' || !('job' in payload)) return null;
  return isHarnessUpdateJob(payload.job) ? payload.job : null;
}

/** The `jobs` field of a status payload, dropping anything that is not a record. */
export function updateJobsFrom(payload: unknown): HarnessUpdateJob[] {
  if (!payload || typeof payload !== 'object' || !('jobs' in payload)) return [];
  const found = payload.jobs;
  return Array.isArray(found) ? found.filter(isHarnessUpdateJob) : [];
}

/**
 * Is this run WAITING for another install to finish?
 *
 * The queue keeps the record on disk before the worker exists, so the ordinary
 * "no pid and not finished" test would call it a run that died without writing a
 * result. `queuedAt` is what separates the two.
 */
export function jobQueued(job: HarnessUpdateJob | null): boolean {
  return job !== null && job.finishedAt === null && job.pid === null && (job.queuedAt ?? null) !== null;
}

/** Is a worker installing right now? A queued run is not one. */
export function jobRunning(job: HarnessUpdateJob | null): boolean {
  return job !== null && job.finishedAt === null && !jobQueued(job);
}

/** Has this record got a result yet (running, queued, or settled)? */
export function jobUnfinished(job: HarnessUpdateJob | null): boolean {
  return job !== null && job.finishedAt === null;
}

/**
 * Is anything still moving for this record?
 *
 * A settled run is not always finished with the reader: the server probes the
 * freshly installed agent afterwards, and until that answer lands the row quotes
 * the version the update just replaced. Both the queue's ticker and the dialog's
 * poll wait for `probe` to leave `pending`.
 */
export function jobMoving(job: HarnessUpdateJob | null): boolean {
  return jobUnfinished(job) || (job !== null && job.probe === 'pending');
}

/** The step the worker is on (`adapter`, `Claude Code`, …), when it says. */
export function runningStepOf(job: HarnessUpdateJob | null): string | null {
  const steps = job && Array.isArray(job.steps) ? job.steps : [];
  return steps.find((step) => step.state === 'running')?.part ?? null;
}
