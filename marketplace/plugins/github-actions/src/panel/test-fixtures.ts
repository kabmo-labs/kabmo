/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The bodies the panel's suites read, so three files do not each own a copy.
 *
 * A suite mounts the assembled panel and asks what it DREW, so the fixture is
 * the answer the server half would have given: one failing run and one passing
 * one, and a run whose first job failed.
 */

import type { RunDetail, RunPage, RunRow } from '../protocol';

export const RUN_SUCCESS: RunRow = {
  id: 1,
  name: 'Gates',
  title: 'fix(terminal): keep the shell attached',
  branch: 'main',
  event: 'push',
  status: 'completed',
  conclusion: 'success',
  state: 'success',
  number: 9,
  attempt: 1,
  actor: 'ana',
  createdAt: '2026-11-20T10:00:00Z',
  startedAt: '2026-11-20T10:00:00Z',
  updatedAt: '2026-11-20T10:02:00Z',
  url: 'https://github.com/o/r/actions/runs/1',
};

export const RUN_FAILURE: RunRow = {
  ...RUN_SUCCESS,
  id: 2,
  name: 'Release',
  title: 'feat(chat): draggable column',
  conclusion: 'failure',
  state: 'failure',
  number: 185,
  updatedAt: '2026-11-20T12:19:35Z',
  url: 'https://github.com/o/r/actions/runs/2',
};

export function page(overrides: Partial<RunPage> = {}): RunPage {
  return {
    slug: 'kabmo-labs/kabmo',
    host: 'github.com',
    authenticated: true,
    branch: '',
    status: '',
    runs: [RUN_FAILURE, RUN_SUCCESS],
    total: 2,
    truncated: false,
    notes: [],
    ...overrides,
  };
}

export function detail(): RunDetail {
  return {
    run: RUN_FAILURE,
    jobs: [
      {
        id: 11,
        name: 'Gates / Checks',
        status: 'completed',
        conclusion: 'failure',
        state: 'failure',
        startedAt: '2026-11-20T12:12:32Z',
        completedAt: '2026-11-20T12:12:54Z',
        runner: 'GitHub Actions 1000003378',
        labels: ['ubuntu-latest'],
        url: null,
        steps: [
          { number: 1, name: 'Set up job', status: 'completed', conclusion: 'success', state: 'success', startedAt: null, completedAt: null },
          { number: 2, name: 'Test', status: 'completed', conclusion: 'failure', state: 'failure', startedAt: null, completedAt: null },
        ],
      },
      {
        id: 12,
        name: 'E2E / Chromium',
        status: 'completed',
        conclusion: 'success',
        state: 'success',
        startedAt: '2026-11-20T12:12:32Z',
        completedAt: '2026-11-20T12:16:00Z',
        runner: 'GitHub Actions 1000003380',
        labels: ['ubuntu-latest'],
        url: null,
        steps: [],
      },
    ],
    progress: { done: 2, total: 2, failing: 1, running: null, runningStep: null },
    notes: [],
  };
}
