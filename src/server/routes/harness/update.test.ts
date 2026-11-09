/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `POST /api/harness/update` and `GET /api/harness/update/status`.
 *
 * The route used to run the installs itself; it now starts a background worker
 * and answers `202`. These cases pin the answers that do NOT spawn anything —
 * the refusals and the progress read — because those are the shapes the dialog
 * branches on, and a wrong status there either starts a competing install or
 * reports success it never observed.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { action } from '@/server/routes/harness/update';
import { loader as statusLoader } from '@/server/routes/harness/update-status';
import { writeUpdateJob } from '@/server/lib/harness/update-job-store';
import type { HarnessUpdateJob } from '@/shared/types/harness-update';

let dir = '';
let originalDataDir: string | undefined;

beforeEach(() => {
  originalDataDir = Bun.env.KABMO_DATA_DIR;
  dir = mkdtempSync(join(tmpdir(), 'kabmo-update-route-'));
  Bun.env.KABMO_DATA_DIR = dir;
});

afterEach(() => {
  if (originalDataDir === undefined) delete Bun.env.KABMO_DATA_DIR;
  else Bun.env.KABMO_DATA_DIR = originalDataDir;
  rmSync(dir, { recursive: true, force: true });
});

function post(harness: string): Parameters<typeof action>[0] {
  return {
    request: new Request('http://localhost/api/harness/update', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ harness }),
    }),
    params: {},
  } as Parameters<typeof action>[0];
}

function job(overrides: Partial<HarnessUpdateJob> = {}): HarnessUpdateJob {
  return {
    harness: 'claude',
    label: 'claude',
    startedAt: Date.now(),
    finishedAt: null,
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

describe('POST /api/harness/update', () => {
  test('an unknown harness is refused before anything runs', async () => {
    const response = (await action(post('nope'))) as Response;
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe('Unknown harness');
  });

  test('a vendor-managed harness is refused with the reason', async () => {
    // `cursor` is updated by its own installer; Kabmo replacing it would be an
    // install it did not make.
    const response = (await action(post('cursor'))) as Response;
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error: string; code: string };
    expect(payload.code).toBe('vendor_managed');
    expect(payload.error).toContain('installed by its vendor');
  });

  test('a second press while a run is in flight is a 409 that names the run', async () => {
    // Measured corruption vector: a reload forgot the run and offered the button,
    // so two `npm install -g` wrote the same prefix at once. The record on disk is
    // what refuses it now.
    await writeUpdateJob(job());
    const response = (await action(post('claude'))) as Response;
    expect(response.status).toBe(409);
    const payload = (await response.json()) as { error: string; job: HarnessUpdateJob };
    expect(payload.error).toContain('already running');
    expect(payload.job.harness).toBe('claude');
  });
});

describe('GET /api/harness/update/status', () => {
  test('no run ever started is null, not a 404', async () => {
    const response = (await statusLoader()) as Response;
    expect(response.status).toBe(200);
    expect(((await response.json()) as { job: unknown }).job).toBeNull();
  });

  test('a finished run is reported with its message', async () => {
    const done = job({
      pid: null,
      finishedAt: Date.now(),
      ok: true,
      applied: true,
      message: 'claude updated (adapter) — check its status to read the new version',
    });
    await writeUpdateJob(done);
    const response = (await statusLoader()) as Response;
    const payload = (await response.json()) as { job: HarnessUpdateJob };
    expect(payload.job.ok).toBe(true);
    expect(payload.job.message).toContain('claude updated');
  });
});
