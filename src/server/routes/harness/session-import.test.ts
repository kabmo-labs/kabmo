/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `POST /api/harness { importSessions: id }` names its harness in its OWN field.
 *
 * The route derived `id` from `probe` alone, so this request was refused as
 * "probe must name a known harness id" before the import branch could run — a
 * button that answered 400 without spawning anything. The built-in refusal is
 * used here because it reaches the import branch and stops there: no agent is
 * launched, and the message proves which branch answered.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { action, loader } from '@/server/routes/harness/root';
import { saveAutoImportEnabled } from '@kabmo-labs/kabmo-harness/session/auto-import.server';

const API = 'http://localhost/api/harness';

function post(body: unknown): Request {
  return new Request(API, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

type Handler = (args: never) => unknown;

function call(handler: Handler, request: Request): Promise<Response> {
  return handler({ request, params: {} } as never) as Promise<Response>;
}

beforeEach(async () => {
  await isolateDb();
});

afterEach(async () => {
  await releaseDb();
});

describe('session import route', () => {
  test('the harness id is read from importSessions, not from probe', async () => {
    const response = await call(action, post({ importSessions: 'omp-rpc' }));
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error?: string; code?: string };
    expect(payload.code).toBe('session_import_failed');
    expect(payload.error).toContain('built in and holds no importable session list');
  });

  test('an unknown harness is refused by name', async () => {
    const response = await call(action, post({ importSessions: 'no-such-harness' }));
    expect(response.status).toBe(400);
  });
});

describe('auto import route', () => {
  test('a built-in harness is refused by the auto-import store', async () => {
    const response = await call(action, post({ probe: 'omp-rpc', autoImport: true }));
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error?: string };
    expect(payload.error).toContain('built in');
  });

  test('the catalog is ON by default and follows an exclusion', async () => {
    const before = await call(loader, new Request(API));
    const initial = (await before.json()) as { harnesses: Array<{ id: string; autoImport?: boolean }> };
    expect(initial.harnesses.find((entry) => entry.id === 'codex')?.autoImport).toBe(true);
    expect(initial.harnesses.find((entry) => entry.id === 'claude')?.autoImport).toBe(true);
    expect(initial.harnesses.find((entry) => entry.id === 'omp-rpc')?.autoImport).toBe(false);

    await saveAutoImportEnabled('claude', false);
    const after = await call(loader, new Request(API));
    const payload = (await after.json()) as { harnesses: Array<{ id: string; autoImport?: boolean }> };
    expect(payload.harnesses.find((entry) => entry.id === 'claude')?.autoImport).toBe(false);
    expect(payload.harnesses.find((entry) => entry.id === 'codex')?.autoImport).toBe(true);
  });
});
