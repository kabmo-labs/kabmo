/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `GET/POST /api/browser/engine` — the refusals, which are the whole contract.
 *
 * The success path shells out to `omp config set`, so it is not exercised here
 * (the resolver's own cases cover the answer). What this file pins is that a
 * malformed request never reaches that write, and that MOCK mode says so
 * instead of pretending a config file changed.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { action, loader } from '@/server/routes/browser/engine';

const originalMock = Bun.env.MOCK;

beforeAll(() => {
  delete Bun.env.MOCK;
});

afterEach(() => {
  if (originalMock === undefined) delete Bun.env.MOCK;
  else Bun.env.MOCK = originalMock;
});

afterAll(() => {
  delete Bun.env.MOCK;
});

function post(body: unknown): Promise<Response> {
  return action({
    params: {},
    request: new Request('http://localhost/api/browser/engine', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  } as never) as Promise<Response>;
}

describe('browser engine route', () => {
  test('a non-boolean webkit is refused before any config write', async () => {
    const res = await post({ webkit: 'false' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('boolean');
  });

  test('a malformed body is refused', async () => {
    const res = await post('{');
    expect(res.status).toBe(400);
  });

  test('MOCK mode refuses the write instead of pretending it landed', async () => {
    Bun.env.MOCK = 'true';
    const res = await post({ webkit: false });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toContain('mock mode');
  });

  test('the loader reports the server mode so the panel can stay quiet in MOCK', async () => {
    Bun.env.MOCK = 'true';
    const res = await loader();
    const body = (await res.json()) as { mock: boolean; effective: string };
    expect(body.mock).toBe(true);
    expect(['webkit', 'chromium']).toContain(body.effective);
  });
});
