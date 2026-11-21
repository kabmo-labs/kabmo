/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The progress line, over the shapes GitHub actually sends.
 *
 * The cases that matter are the ones a naive count gets wrong: a job whose
 * `status` is `completed` but whose conclusion is missing, a run whose one
 * running job has not started yet (so it has no step to name), and a matrix that
 * adds a job after the reader opened the page.
 */

import { describe, expect, test } from 'bun:test';

import type { Job } from '../protocol';
import { failingJobs, progressOf, rollupState, runningJob, runningStepOf } from './progress';

function job(partial: Partial<Job> & { id: number }): Job {
  return {
    name: `job ${partial.id}`,
    status: 'completed',
    conclusion: 'success',
    state: 'success',
    startedAt: '2026-11-20T12:00:00Z',
    completedAt: '2026-11-20T12:01:00Z',
    runner: null,
    labels: [],
    url: null,
    steps: [],
    ...partial,
  };
}

describe('progressOf', () => {
  test('counts finished jobs out of the jobs known', () => {
    const jobs = [
      job({ id: 1 }),
      job({ id: 2, status: 'in_progress', conclusion: null, state: 'pending', completedAt: null }),
      job({ id: 3, status: 'queued', conclusion: null, state: 'pending', startedAt: null, completedAt: null }),
    ];
    expect(progressOf(jobs)).toEqual({
      done: 1,
      total: 3,
      failing: 0,
      running: 'job 2',
      runningStep: null,
    });
  });

  test('names the step of the job that is actually running', () => {
    const running = job({
      id: 9,
      name: 'Gates / Checks',
      status: 'in_progress',
      conclusion: null,
      state: 'pending',
      completedAt: null,
      steps: [
        { number: 1, name: 'Set up job', status: 'completed', conclusion: 'success', state: 'success', startedAt: null, completedAt: null },
        { number: 2, name: 'Checkout', status: 'completed', conclusion: 'success', state: 'success', startedAt: null, completedAt: null },
        { number: 3, name: 'Test', status: 'in_progress', conclusion: null, state: 'pending', startedAt: null, completedAt: null },
        { number: 4, name: 'Upload', status: 'queued', conclusion: null, state: 'pending', startedAt: null, completedAt: null },
      ],
    });
    const progress = progressOf([running]);
    expect(progress.runningStep).toBe('3/4 Test');
    expect(progress.done).toBe(0);
  });

  test('a failing job is counted and rolled up', () => {
    const jobs = [job({ id: 1 }), job({ id: 2, conclusion: 'failure', state: 'failure' })];
    expect(progressOf(jobs).failing).toBe(1);
    expect(failingJobs(jobs).map((entry) => entry.id)).toEqual([2]);
    expect(rollupState(jobs, 'success')).toBe('failure');
  });

  test('a queued job that has not started is not named as running', () => {
    const queued = job({
      id: 4,
      status: 'queued',
      conclusion: null,
      state: 'pending',
      startedAt: null,
      completedAt: null,
    });
    expect(runningJob([queued])).toBeNull();
    expect(runningStepOf(null)).toBeNull();
  });

  test('no jobs means no state to roll up, so the run keeps its own', () => {
    expect(rollupState([], 'pending')).toBe('pending');
    expect(progressOf([])).toEqual({ done: 0, total: 0, failing: 0, running: null, runningStep: null });
  });
});
