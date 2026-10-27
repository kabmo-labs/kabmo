/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The one formatter for omp's running-task telemetry (`wait` / `proc://` job
 * rows). Measured against omp 18.13.0's own suffix:
 * `— 90 req · $18.40 · ctx 160K/1M · stage: implementing`.
 */

import { describe, expect, test } from 'bun:test';
import { jobProgressLine, jobProgressParts } from '@/shared/lib/omp/session/job-progress';

const RUNNING = {
  status: 'running',
  requests: 90,
  cost: 18.4,
  contextTokens: 163_840,
  contextWindow: 1_048_576,
  stage: 'implementing',
};

describe('jobProgressParts', () => {
  test('reads every field omp reports on a running task', () => {
    expect(jobProgressParts(RUNNING)).toEqual([
      '90 req',
      '$18.40',
      'ctx 163.8K/1.0M',
      'stage: implementing',
    ]);
  });

  test('a sub-cent spend is reported as a ceiling, not as $0.00', () => {
    expect(jobProgressParts({ status: 'running', cost: 0.004 })).toEqual(['<$0.01']);
    expect(jobProgressParts({ status: 'running', cost: 0.005 })).toEqual(['$0.01']);
  });

  test('context fill without a window prints one number', () => {
    expect(jobProgressParts({ status: 'running', contextTokens: 1_600 })).toEqual(['ctx 1.6K']);
  });

  test('the estimated percent is opt-in, because the wait row already shows it', () => {
    const job = { ...RUNNING, completionPercent: 40 };
    expect(jobProgressParts(job)).not.toContain('~40%');
    expect(jobProgressParts(job, { includePercent: true })).toContain('~40%');
  });

  test('a settled row reports nothing, so a stored snapshot cannot look live', () => {
    expect(jobProgressParts({ ...RUNNING, status: 'completed' })).toEqual([]);
    expect(jobProgressParts({ ...RUNNING, status: undefined })).toEqual([]);
  });

  test('zero values are omissions, not measurements', () => {
    expect(jobProgressParts({ status: 'running', requests: 0, cost: 0 })).toEqual([]);
  });

  test('a multi-line stage is collapsed', () => {
    expect(jobProgressParts({ status: 'running', stage: 'writing\n  the  report' })).toEqual([
      'stage: writing the report',
    ]);
  });
});

describe('jobProgressLine', () => {
  test('joins the parts with omp\'s separator', () => {
    expect(jobProgressLine({ ...RUNNING, requests: 90, stage: undefined })).toBe(
      '90 req · $18.40 · ctx 163.8K/1.0M',
    );
  });

  test('is undefined when there is nothing to say', () => {
    expect(jobProgressLine({ status: 'running' })).toBeUndefined();
    expect(jobProgressLine({ status: 'failed', requests: 12 })).toBeUndefined();
  });
});
