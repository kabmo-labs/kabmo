/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * How far a run has got, from the only data GitHub offers.
 *
 * There is no percentage field and no ETA: a run is a set of jobs, each job is a
 * set of steps, and each carries `status` plus `conclusion`. So the honest answer
 * is a count — `14/31 jobs` — plus the step the one running job is on. An
 * invented percentage would move backwards the moment the host adds a job (a
 * dynamic matrix does exactly that), which is worse than no number.
 *
 * `failing` is a ROLL-UP of the same four states the badges use, so one failing
 * job in thirty is a failing run — that is what blocks a merge.
 */

import type { Job, RunProgress, RunState } from '../protocol';
import { stateOf, worstState } from '../state';

/** The jobs that did not pass, in the order the host listed them. */
export function failingJobs(jobs: readonly Job[]): Job[] {
  return jobs.filter((job) => job.state === 'failure');
}

/** The job in flight, if there is exactly one worth naming. */
export function runningJob(jobs: readonly Job[]): Job | null {
  return jobs.find((job) => job.state === 'pending' && job.startedAt) ?? null;
}

/** The step that job is on, as `7/13 Checkout`. */
export function runningStepOf(job: Job | null): string | null {
  if (!job) return null;
  const index = job.steps.findIndex((step) => step.state === 'pending');
  const step = job.steps[index];
  if (!step) return null;
  return `${step.number}/${job.steps.length} ${step.name}`;
}

/** Progress for a run's job list. */
export function progressOf(jobs: readonly Job[]): RunProgress {
  const running = runningJob(jobs);
  return {
    done: jobs.filter((job) => job.status === 'completed').length,
    total: jobs.length,
    failing: failingJobs(jobs).length,
    running: running?.name ?? null,
    runningStep: runningStepOf(running),
  };
}

/** The run's own state, rolled up from its jobs when the host states none. */
export function rollupState(jobs: readonly Job[], fallback: RunState): RunState {
  const worst = worstState(jobs.map((job) => job.state));
  return worst ?? fallback;
}

/** One job's state, from the pair GitHub actually sends. */
export function jobState(job: { status: string; conclusion: string | null }): RunState {
  return stateOf(job.status, job.conclusion);
}
