/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `POST /api/browser/:sessionId/tabs/close` — the refusals, which are the whole
 * contract reachable without a real Chromium.
 *
 * A close request is an ACT of the user on someone else's browser, so every
 * path that does not close must say why: no session, no shared browser, a tab
 * that belongs to another session, a malformed id. The happy path itself is a
 * single CDP call whose behaviour is measured in `shared/lib/browser/tab-close.ts`
 * (Chromium 1248: `{"success":true}`, the socket survives, the attached session
 * dies on its own), and its policy — which ids may be closed at all — is pinned
 * in `tab-close.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import path from 'node:path';

import { action } from '@/server/routes/browser/tabs';

const originalMock = Bun.env.MOCK;
const globals = globalThis as unknown as { __ompSessions?: Map<string, unknown> };
const SESSION = 'tabs-close-test-session';

beforeEach(() => {
  delete Bun.env.MOCK;
  if (!globals.__ompSessions) globals.__ompSessions = new Map();
});

afterEach(() => {
  globals.__ompSessions?.delete(SESSION);
  if (originalMock === undefined) delete Bun.env.MOCK;
  else Bun.env.MOCK = originalMock;
});

function post(body: unknown, sessionId = SESSION): Promise<Response> {
  return action({
    params: { sessionId },
    request: new Request(`http://localhost/api/browser/${sessionId}/tabs/close`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  } as never) as Promise<Response>;
}

describe('browser tab close route', () => {
  test('a session this process does not run owns no tabs to close', async () => {
    const res = await post({ targetId: 'abc' });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toContain('not running');
  });

  test('a malformed target id is refused before any browser is touched', async () => {
    globals.__ompSessions?.set(SESSION, { pid: process.pid, cwd: process.cwd(), isAlive: () => true });
    for (const targetId of [undefined, '', 'a b', '../x', 7]) {
      const res = await post({ targetId });
      expect(res.status).toBe(400);
    }
  });

  test('a body that is not JSON is refused with 400, not a crash', async () => {
    globals.__ompSessions?.set(SESSION, { pid: process.pid, cwd: process.cwd(), isAlive: () => true });
    const res = await post('{not json');
    expect(res.status).toBe(400);
  });

  test('a project with no running shared browser reports 503', async () => {
    globals.__ompSessions?.set(SESSION, {
      pid: process.pid,
      // A directory with no scope.json: discovery finds no runtime for it.
      cwd: path.join(process.cwd(), 'tmp-no-browser-here'),
      isAlive: () => true,
    });
    const res = await post({ targetId: 'abc' });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toContain('No shared browser');
  });

  test('MOCK mode never reaches a daemon', async () => {
    Bun.env.MOCK = '1';
    globals.__ompSessions?.set(SESSION, { pid: process.pid, cwd: process.cwd(), isAlive: () => true });
    const res = await post({ targetId: 'abc' });
    expect(res.status).toBe(503);
  });

  test('a missing sessionId is a client error, not a silent no-op', async () => {
    const res = await post({ targetId: 'abc' }, '');
    expect(res.status).toBe(400);
  });
});
