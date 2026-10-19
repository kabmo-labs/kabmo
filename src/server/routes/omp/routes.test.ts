/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The `/api/omp/*` request contract.
 *
 * Every handler here talks to a live omp child on its success path, which these
 * tests never spawn. What they pin instead is everything that decides BEFORE
 * the child is reached: the mock-mode short-circuits (the demo must not shell
 * out), the validation envelopes (a missing `providerId`, a malformed
 * extension toggle) and the 405s.
 *
 * `PI_CODING_AGENT_DIR` and `MOCK` are process-wide, so both are snapshotted and
 * restored; sibling suites share the `bun test` process.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { action as login } from '@/server/routes/omp/login';
import { invalidateOmpCliCache } from '@/server/lib/omp/core/cli';

const AGENT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omc-omp-routes-'));
const ORIGINAL_ENV = {
  MOCK: Bun.env.MOCK,
  PI_CODING_AGENT_DIR: Bun.env.PI_CODING_AGENT_DIR,
  KABMO_OMP_BIN: Bun.env.KABMO_OMP_BIN,
};
/** The runner's own fetch, reached through `Bun` so a stub leaked onto the global cannot be mistaken for it. */
const originalFetch = Bun.fetch;

beforeEach(() => {
  fs.rmSync(path.join(AGENT_DIR, 'sessions'), { recursive: true, force: true });
  fs.rmSync(path.join(AGENT_DIR, 'extensions'), { recursive: true, force: true });
  fs.rmSync(path.join(AGENT_DIR, 'config.yml'), { force: true });
  Bun.env.PI_CODING_AGENT_DIR = AGENT_DIR;
  // No omp child may be spawned: a non-existent override makes `resolveOmpBin()`
  // answer null, so the plugin bridge stops before `Bun.spawn`.
  Bun.env.KABMO_OMP_BIN = path.join(AGENT_DIR, 'no-such-omp');
  // `resolveOmpBin` memoizes the first binary IT resolved for the process, so a
  // sibling suite's stub would otherwise be reused here (and this file's
  // non-existent override cached for the files after it).
  invalidateOmpCliCache();
  delete Bun.env.MOCK;
  // The id index and the release cache hang off globalThis; a fixture must not
  // survive into a sibling suite.
  delete (globalThis as { __kabmoSessionIdIndex?: unknown }).__kabmoSessionIdIndex;
});

afterEach(() => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete Bun.env[key];
    else Bun.env[key] = value;
  }
  invalidateOmpCliCache();
  globalThis.fetch = originalFetch;
  delete (globalThis as { __kabmoLoginResponseSink?: unknown }).__kabmoLoginResponseSink;
  delete (globalThis as { __kabmoModelsDevCatalog?: unknown }).__kabmoModelsDevCatalog;
});

afterAll(() => {
  fs.rmSync(AGENT_DIR, { recursive: true, force: true });
});

async function payload(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

function post(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('POST /api/omp/login', () => {
  const url = 'http://localhost/api/omp/login';

  test('a wrong verb is a 405', async () => {
    const res = (await login({ request: new Request(url, { method: 'GET' }), params: {} } as never)) as Response;
    expect(res.status).toBe(405);
    expect((await payload(res)).error).toBe('Method not allowed');
  });

  test('a missing or blank providerId is a 400', async () => {
    for (const body of [{}, { providerId: '' }, { providerId: '   ' }, { providerId: 7 }]) {
      const res = (await login({ request: post(url, body), params: {} } as never)) as Response;
      expect(res.status).toBe(400);
      expect((await payload(res)).error).toBe('providerId is required');
    }
  });

  test('a malformed JSON body is a 400, not a spawn', async () => {
    const res = (await login({ request: post(url, 'not json'), params: {} } as never)) as Response;
    expect(res.status).toBe(400);
    expect((await payload(res)).error).toBe('providerId is required');
  });

  test('refuses to start a login in MOCK mode', async () => {
    Bun.env.MOCK = '1';
    const res = (await login({ request: post(url, { providerId: 'anthropic' }), params: {} } as never)) as Response;
    expect(res.status).toBe(400);
    expect((await payload(res)).error).toBe('Login is unavailable in mock mode');
  });

  test('forwards an in-flight extension_ui_response to the registered sink', async () => {
    const seen: Array<Record<string, unknown>> = [];
    (globalThis as { __kabmoLoginResponseSink?: (frame: Record<string, unknown>) => void }).__kabmoLoginResponseSink =
      (frame) => seen.push(frame);
    const frame = { id: 'ui-1', type: 'extension_ui_response', value: 'sk-abc' };

    const res = (await login({ request: post(url, frame), params: {} } as never)) as Response;
    expect(res.status).toBe(200);
    expect(await payload(res)).toEqual({ success: true });
    expect(seen).toEqual([frame]);
  });

  test('an extension_ui_response with no login in flight is not treated as a login start', async () => {
    // No sink is registered, so the frame falls through to the providerId check
    // rather than spawning a process.
    const res = (await login({
      request: post(url, { id: 'ui-1', type: 'extension_ui_response' }),
      params: {},
    } as never)) as Response;
    expect(res.status).toBe(400);
    expect((await payload(res)).error).toBe('providerId is required');
  });
});
