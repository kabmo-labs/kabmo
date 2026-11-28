/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The last-opened route pair's request contract.
 *
 * The read is what the SSR bootstrap and any late caller trust, and the write is
 * what a shell's next launch depends on — so the cases here pin the refusals
 * that would otherwise be silent: a wrong verb must not be read as "nothing
 * recorded", a blank or path-shaped id must not reach the store, a pending
 * placeholder must answer `recorded: false`, and one client's write must not
 * become another client's restore.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { getDb } from '@/server/db.server';
import type { DbClient } from '@kabmo-labs/kabmo-db/client';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@kabmo-labs/kabmo-http';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { getLastOpenedSession, markSessionOpened } from '@/server/routes/sessions/last-opened';
import { readLastOpenedSessionId } from '@/server/lib/sessions/last-opened.server';
import { CLIENT_COOKIE } from '@/server/lib/sessions/last-opened-client.server';

const SESSION_ID = '43';
const CLIENT = '11111111-2222-4333-8444-555555555555';
const OTHER_CLIENT = '99999999-8888-4777-8666-555555555555';
let db: DbClient;
let priorMock: string | undefined;

beforeAll(() => {
  priorMock = Bun.env.MOCK;
  Bun.env.MOCK = 'true';
});

beforeEach(async () => {
  await isolateDb();
  db = await getDb();
  await db.run("INSERT OR IGNORE INTO workspace_folders (id, name) VALUES (8, 'test')");
  await db.run('INSERT INTO sessions (id, folder_id, title) VALUES (?, 8, ?)', [SESSION_ID, 'Probe']);
});

afterEach(async () => {
  await releaseDb();
});

afterAll(() => {
  if (priorMock === undefined) delete Bun.env.MOCK;
  else Bun.env.MOCK = priorMock;
});

function request(method: string, clientId?: string): Request {
  return new Request('http://localhost/api/x', {
    method,
    headers: clientId ? { cookie: `${CLIENT_COOKIE}=${clientId}` } : {},
  });
}

function actionArgs(method: string, sessionId?: string, clientId?: string): ActionFunctionArgs {
  return {
    request: request(method, clientId),
    params: sessionId === undefined ? {} : { sessionId },
  };
}

function loaderArgs(clientId?: string): LoaderFunctionArgs {
  return { request: request('GET', clientId), params: {} };
}

async function readBody(response: unknown): Promise<Record<string, unknown>> {
  return (await (response as Response).json()) as Record<string, unknown>;
}

describe('getLastOpenedSession', () => {
  test('answers no-store, because the value moves with every open', async () => {
    const response = (await getLastOpenedSession(loaderArgs(CLIENT))) as Response;
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await readBody(response)).toEqual({ sessionId: null });
  });

  test('a request with no client cookie has no pointer', async () => {
    expect(await readBody(await getLastOpenedSession(loaderArgs()))).toEqual({ sessionId: null });
  });
});

describe('markSessionOpened', () => {
  test('records a real session, and the read answers it for that client', async () => {
    const posted = await markSessionOpened(actionArgs('POST', SESSION_ID, CLIENT));
    expect(await readBody(posted)).toEqual({ success: true, recorded: true });
    expect(await readBody(await getLastOpenedSession(loaderArgs(CLIENT)))).toEqual({
      sessionId: SESSION_ID,
    });
  });

  test("one client's write is not another client's restore", async () => {
    await markSessionOpened(actionArgs('POST', SESSION_ID, CLIENT));
    expect(await readBody(await getLastOpenedSession(loaderArgs(OTHER_CLIENT)))).toEqual({
      sessionId: null,
    });
  });

  test('a request without a cookie gets one, and it is what gets recorded', async () => {
    const posted = (await markSessionOpened(actionArgs('POST', SESSION_ID))) as Response;
    const cookie = posted.headers.get('set-cookie');
    expect(cookie).toContain(CLIENT_COOKIE);
    expect(await readBody(posted)).toEqual({ success: true, recorded: true });

    const clientId = cookie?.match(new RegExp(`${CLIENT_COOKIE}=([^;]+)`))?.[1] ?? '';
    expect(await readBody(await getLastOpenedSession(loaderArgs(decodeURIComponent(clientId))))).toEqual({
      sessionId: SESSION_ID,
    });
  });

  test('a pending placeholder is refused without failing the request', async () => {
    const posted = await markSessionOpened(actionArgs('POST', 'new-1761000000000', CLIENT));
    expect((posted as Response).status).toBe(200);
    expect(await readBody(posted)).toEqual({ success: true, recorded: false });
    expect(await readLastOpenedSessionId(CLIENT)).toBeNull();
  });

  test('a wrong verb is a 405', async () => {
    const response = (await markSessionOpened(actionArgs('GET', SESSION_ID, CLIENT))) as Response;
    expect(response.status).toBe(405);
  });

  test('a missing id is a 400', async () => {
    const response = (await markSessionOpened(actionArgs('POST'))) as Response;
    expect(response.status).toBe(400);
  });

  test('a path-shaped id is a 404 before the store sees it', async () => {
    for (const id of ['.', '..', 'a/b', 'a\\b']) {
      const response = (await markSessionOpened(actionArgs('POST', id, CLIENT))) as Response;
      expect(response.status).toBe(404);
    }
  });
});
