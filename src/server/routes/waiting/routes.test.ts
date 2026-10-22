/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `/api/waiting` POST — the refusals that guard the row.
 *
 * The case worth pinning is the WORKING DIRECTORY, because it is the one that
 * only fails on a platform the author does not run: the route tested
 * `cwd.startsWith('/')`, so every hold from a Windows workspace (`C:\…`) was
 * refused with `cwd_required` and the prompt was sent immediately instead of
 * being deferred — measured on the Windows CI leg of
 * `waiting-prompt.e2e.ts`, where the browser showed the toast and the row was
 * never created. The fix is `path.isAbsolute`, which is what this asserts on
 * both platform shapes rather than only the one this run happens to be on.
 *
 * Everything else here is the validation order a stale client can reach: a
 * missing dependency, an empty prompt, a mock install.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { action } from '@/server/routes/waiting/index';
import { listWaitingPrompts } from '@/server/lib/waiting/store.server';

const ROOT = path.join(os.tmpdir(), `kabmo-waiting-routes-${process.pid}`);

function post(body: unknown): Request {
  return new Request('http://localhost/api/waiting', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function call(body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = (await action({ request: post(body), params: {} } as never)) as Response;
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

beforeAll(async () => {
  fs.mkdirSync(ROOT, { recursive: true });
  await isolateDb();
});

afterAll(async () => {
  await releaseDb();
  fs.rmSync(ROOT, { recursive: true, force: true });
});

describe('/api/waiting — working directory', () => {
  // The rule is the SERVER's own platform rule (`path.isAbsolute`), because a
  // hold's cwd is a directory on the machine that will spawn the session — the
  // client sends the folder's stored `project_path`, which the server resolved.
  //
  // This table is derived from `path.isAbsolute` rather than written out, so it
  // is a real regression net on BOTH legs: on Windows it feeds `C:\…`, which
  // the old `startsWith('/')` refused, and on POSIX it feeds `/…`. Hardcoding
  // either spelling would assert the platform this run happens to be on.
  //
  // The dependency must look UNFINISHED for a create to reach the store, and a
  // session id nothing has ever streamed is settled by definition — so these
  // cases assert the CWD verdict, which is decided BEFORE that read.
  const shapes = [
    path.join(ROOT, 'projects', 'kabmo'),
    '/home/dev/projects/kabmo',
    'C:\\Users\\dev\\projects\\kabmo',
    '\\\\server\\share\\kabmo',
    'projects/kabmo',
    'C:relative',
    '',
  ];

  for (const cwd of shapes) {
    const absolute = path.isAbsolute(cwd);
    test(`${JSON.stringify(cwd)} is ${absolute ? 'accepted' : 'refused as relative'}`, async () => {
      const res = await call({ dependsOn: 'sess-anything', prompt: 'held', cwd });
      if (absolute) {
        // `dependency_idle` is the next gate: the cwd passed.
        expect(res.body.code).not.toBe('cwd_required');
      } else {
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('cwd_required');
      }
    });
  }

  test('a whitespace-only path is refused, never trimmed into a valid one', async () => {
    const res = await call({ dependsOn: 'sess-anything', prompt: 'x', cwd: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('cwd_required');
  });
});

describe('/api/waiting — the rest of the validation order', () => {
  test('a missing dependency is refused before the path is read', async () => {
    const res = await call({ prompt: 'x', cwd: '/tmp/x' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('depends_on_required');
  });

  test('a dependency that could name a path is refused', async () => {
    const res = await call({ dependsOn: '../../etc', prompt: 'x', cwd: '/tmp/x' });
    expect(res.body.code).toBe('depends_on_required');
  });

  test('an empty prompt with no attachment is refused', async () => {
    const res = await call({ dependsOn: 'sess-anything', prompt: '  ', cwd: '/tmp/x' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('prompt_required');
  });

  test('a refusal writes no row', async () => {
    await call({ dependsOn: 'sess-anything', prompt: 'x', cwd: 'relative/path' });
    expect(await listWaitingPrompts()).toHaveLength(0);
  });
});
