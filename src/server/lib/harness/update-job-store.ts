/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The harness update record on disk: read it, write it atomically, and tell a
 * live run from a dead one.
 *
 * Kept apart from `update-job.server.ts` because the DETACHED WORKER writes the
 * same record (`update-worker.ts`) and must not import the server's database and
 * config modules to do it. One writer, one file shape, two processes.
 *
 * **A run outlives the request that started it.** The POST answers in
 * milliseconds while the install keeps going, so the state cannot live in a
 * closure or a `Map`: a reloaded page, a second tab and a `bun --hot` reload all
 * have to read the same answer. It is one JSON file, replaced atomically
 * (`tmp` + `rename`), which is why a reader never sees half a record.
 */

import fs from 'node:fs';
import { getHarnessUpdateStatusPath } from '@/server/lib/lifecycle/paths';
import { isHarnessUpdateJob } from '@/shared/lib/harness/update-job';
import type { HarnessUpdateJob } from '@/shared/types/harness-update';

/**
 * How long a just-started job is trusted without a live pid.
 *
 * The server writes the record, then spawns the worker; for those first moments
 * there is a `finishedAt: null` record and no worker pid yet. Reading that as "it
 * died" would report a failure over a run that is about to start. Fifteen
 * seconds is far longer than that handshake and far shorter than a human's
 * patience for a stale row.
 */
export const UPDATE_START_GRACE_MS = 15_000;

/** The current record, or null when none was ever written (or it is unreadable).
 *  `path` is the record the caller owns: the server uses the install's run
 *  directory, the detached worker uses the one its spec names. */
export async function readUpdateJob(path = getHarnessUpdateStatusPath()): Promise<HarnessUpdateJob | null> {
  try {
    const parsed = (await Bun.file(path).json()) as unknown;
    return isHarnessUpdateJob(parsed) ? parsed : null;
  } catch {
    // Absent (never run) and corrupt (a half-written record from an old build)
    // are the same answer: there is nothing to report.
    return null;
  }
}

/** Replace the record atomically. A reader sees the previous one or this one. */
export async function writeUpdateJob(job: HarnessUpdateJob, path = getHarnessUpdateStatusPath()): Promise<void> {
  const target = path;
  const temp = `${target}.${process.pid}.tmp`;
  await Bun.write(temp, JSON.stringify(job, null, 2));
  await fs.promises.rename(temp, target);
}

/** Is this pid a live process? `EPERM` means it exists and is not ours. */
export function pidAlive(pid: number | null): boolean {
  if (!pid || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    return (cause as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Is this run still going?
 *
 * A known-live pid settles it. Without one the record is trusted only inside the
 * start grace window; after that an absent worker means the run died without
 * writing a result, and the caller reports that instead of polling forever.
 */
export function jobInFlight(job: HarnessUpdateJob | null, now = Date.now()): boolean {
  if (!job || job.finishedAt !== null) return false;
  if (pidAlive(job.pid)) return true;
  return now - job.startedAt < UPDATE_START_GRACE_MS;
}

/**
 * The record with a run that died without reporting turned into a failure.
 *
 * `finishedAt` is what every reader keys on, so settling here is what stops the
 * dialog from spinning forever; the message says the install itself may have
 * completed, because a killed reporter is not proof the commands failed.
 */
export async function settleDeadJob(
  job: HarnessUpdateJob | null,
  path = getHarnessUpdateStatusPath(),
): Promise<HarnessUpdateJob | null> {
  // A record that already has a result is history, not a candidate: the worker
  // wrote it, and rewriting it would turn a success into a "stopped without
  // reporting" failure.
  if (!job || job.finishedAt !== null || jobInFlight(job)) return job;
  const settled: HarnessUpdateJob = {
    ...job,
    finishedAt: Date.now(),
    pid: null,
    ok: false,
    applied: true,
    message: `${job.label} update stopped without reporting a result — check its status before trying again`,
    steps: job.steps.map((step) => (step.state === 'running' ? { ...step, state: 'failed' } : step)),
  };
  await writeUpdateJob(settled, path);
  return settled;
}
