/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `POST /api/console/restart` — the settings sidebar's Restart button.
 *
 * The route can end the process serving the request, so its contract is pinned
 * where it can be exercised without arming one: the verb check, the MOCK
 * refusal (a demo must not take a server down), and the refusal an instance the
 * CLI does not own gets — which is the only branch that answers without
 * spawning a detached `kabmo restart`. The armed branch is pinned in
 * `lifecycle/restart.test.ts` through the decision it makes.
 *
 * `KABMO_DATA_DIR` and `PORT` are process-wide, so both are snapshotted
 * and restored; sibling suites share the `bun test` process.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { action as restartRoute } from '@/server/routes/console/restart';
import { writeInstanceRecord } from '@/server/lib/lifecycle/instance';

const ORIGINAL_ENV = {
  MOCK: Bun.env.MOCK,
  KABMO_DATA_DIR: Bun.env.KABMO_DATA_DIR,
  PORT: Bun.env.PORT,
};
const fixtures: string[] = [];

async function payload(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omc-chamber-restart-'));
  fixtures.push(dir);
  Bun.env.KABMO_DATA_DIR = dir;
  delete Bun.env.MOCK;
  delete Bun.env.PORT;
});

afterEach(() => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete Bun.env[key];
    else Bun.env[key] = value;
  }
  for (const dir of fixtures.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('POST /api/console/restart', () => {
  test('a wrong verb is a 405', async () => {
    const res = (await restartRoute({
      request: new Request('http://localhost/api/console/restart', { method: 'GET' }),
      params: {},
    } as never)) as Response;
    expect(res.status).toBe(405);
    expect((await payload(res)).error).toBe('Method not allowed');
  });

  test('refuses to take a server down in MOCK mode', async () => {
    Bun.env.MOCK = '1';
    const res = (await restartRoute({ request: new Request("http://localhost/api/console/restart", { method: "POST" }), params: {} } as never)) as Response;
    expect(res.status).toBe(200);
    const body = await payload(res);
    expect(body.restarting).toBe(false);
    expect(body.isMock).toBe(true);
    expect(body.message).toContain('mock mode');
  });

  test('a source-run instance is refused with the restart wording, not the update one', async () => {
    // `bun run dev` records `direct`: replacing it would end the user's loop, so
    // the route answers a refusal and never arms the detached restart.
    writeInstanceRecord({
      pid: process.pid,
      port: 4301,
      host: 'localhost',
      mode: 'dev',
      launchMode: 'direct',
      tray: false,
      tls: false,
      auth: false,
      startedAt: '2026-10-01T10:00:00.000Z',
      version: '0.5.0',
    });
    const res = (await restartRoute({ request: new Request("http://localhost/api/console/restart", { method: "POST" }), params: {} } as never)) as Response;
    expect(res.status).toBe(200);
    const body = await payload(res);
    expect(body.success).toBe(true);
    expect(body.restarting).toBe(false);
    expect(String(body.message)).toContain('runs from source');
    expect(String(body.message)).not.toContain('apply the update');
  });
});
