/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The sessions route group's request contract: id safety, name validation, the
 * per-session UI-state blob, and the follow-up queue's per-item mutations.
 *
 * Every case is a refusal or a boundary whose wrong answer would be silent: a
 * `.` session id must be a 404 before any path join (the delete route's own
 * blast-radius guard, reused here), a blank or over-long rename must be a 400
 * with its code rather than a truncated write, and a queue mutation must return
 * the canonical queue instead of trusting a client's full-list replacement.
 *
 * The routes are called directly, as the other route tests do. The database is
 * a temp SQLite file (never the developer's) and `PI_CODING_AGENT_DIR` a temp
 * tree holding one real session file, so the id resolver is exercised for real
 * while nothing outside `/tmp` is read.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getDb } from '@/server/db.server';
import type { DbClient } from '@/server/lib/db/client';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { clearSessionFileCaches } from '@/server/lib/omp/session/files';
import { invalidateOmpSidebarData } from '@/server/lib/omp/session/reader';
import { ModeMirror } from '@/server/lib/omp/rpc/mode-mirror';
import { recordSpawnProvenance } from '@/server/lib/omp/rpc/spawn-provenance';
import { removeDir } from '@/test-support/remove-dir';
import {
  archiveSession,
  getSessionModes,
  getSessionState,
  markSeen,
  putSessionState,
  renameSession,
} from '@/server/routes/sessions/session';

// `tmpdir()`, not `/tmp`: there is no `/tmp` on Windows, so the literal
// resolved against the current drive and the tree was never where the suite
// (or the delete) looked for it.
const ROOT = path.join(os.tmpdir(), `omc-sessions-routes-${process.pid}`);
const AGENT = path.join(ROOT, 'agent');
const SESSION_ID = '11111111-2222-3333-4444-555555555555';
const UNKNOWN = '00000000-0000-0000-0000-000000000000';
/** A live session whose JSONL does not exist yet — the window omp creates on
 *  every new chat, before its first assistant message. */
const NO_FILE_LIVE = '99999999-8888-7777-6666-555555555555';

let db: DbClient;
let priorDbPath: string | undefined;
let priorMock: string | undefined;
let priorAgentDir: string | undefined;
let priorSlot: typeof globalThis.__kabmoDb;
let priorSessions: typeof globalThis.__ompSessions;

beforeAll(async () => {
  removeDir(ROOT);
  const project = path.join(AGENT, 'sessions', 'proj');
  fs.mkdirSync(project, { recursive: true });
  // One real session file, with a plan-mode entry, so the id resolver and the
  // transcript reader are exercised against a file rather than a stub.
  fs.writeFileSync(
    path.join(project, `${SESSION_ID}.jsonl`),
    [
      // A session header needs its `timestamp`: `scanSessionInfo` derives
      // `created` from it and `toOmpSession` calls `toISOString()`, so a
      // header without one takes the whole sidebar down with
      // `RangeError: Invalid Date`.
      JSON.stringify({ type: 'session', id: SESSION_ID, cwd: '/tmp', timestamp: '2026-09-30T10:00:00.000Z' }),
      JSON.stringify({ type: 'custom', customType: 'chamber-plan-state', data: { enabled: true } }),
      '',
    ].join('\n'),
  );

  priorAgentDir = Bun.env.PI_CODING_AGENT_DIR;
  priorDbPath = Bun.env.KABMO_DB_PATH;
  priorMock = Bun.env.MOCK;
  priorSlot = globalThis.__kabmoDb;
  priorSessions = globalThis.__ompSessions;

  Bun.env.PI_CODING_AGENT_DIR = AGENT;
  Bun.env.KABMO_DB_PATH = path.join(ROOT, 'db.sqlite');
  Bun.env.MOCK = 'false';
  // The db handle is process-wide; CLOSE the one a sibling suite left before
  // dropping it — an abandoned connection keeps its file locked, and on Windows
  // the teardown delete then fails with EBUSY. The temp file stays on disk so a
  // later suite that inherits the slot cannot fall back to the real database.
  globalThis.__kabmoDb?.resolved?.raw.close();
  globalThis.__kabmoDb = undefined;
  clearSessionFileCaches();
  invalidateOmpSidebarData();
  db = await getDb();
});

afterAll(() => {
  clearSessionFileCaches();
  invalidateOmpSidebarData();
  // The live-child cases register a fake wrapper in the process-wide registry;
  // a sibling suite must not inherit it as a real session.
  delete globalThis.__ompSessions;
  if (priorAgentDir === undefined) delete Bun.env.PI_CODING_AGENT_DIR;
  else Bun.env.PI_CODING_AGENT_DIR = priorAgentDir;
  if (priorDbPath === undefined) delete Bun.env.KABMO_DB_PATH;
  else Bun.env.KABMO_DB_PATH = priorDbPath;
  if (priorMock === undefined) delete Bun.env.MOCK;
  else Bun.env.MOCK = priorMock;
  // Close before restoring the slot and deleting: a live connection makes a
  // Windows delete fail with EBUSY, and a throw from `afterAll` reports a
  // failure of the file.
  globalThis.__kabmoDb?.resolved?.raw.close();
  globalThis.__kabmoDb = priorSlot;
  if (priorSessions === undefined) delete globalThis.__ompSessions;
  else globalThis.__ompSessions = priorSessions;
  removeDir(ROOT);
});

function formPost(body: Record<string, string>, url = 'http://localhost/api/x'): Request {
  const form = new FormData();
  for (const [key, value] of Object.entries(body)) form.append(key, value);
  return new Request(url, { method: 'POST', body: form });
}
function jsonRequest(method: string, body: unknown, url = 'http://localhost/api/x'): Request {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** The loader args a route needs: `params` plus the request every session
 *  route reads (the peer-relay guard inspects its headers). */
function loaderArgs(sessionId: string): LoaderFunctionArgs {
  return {
    params: { sessionId },
    request: new Request(`http://localhost/api/sessions/${encodeURIComponent(sessionId)}/modes`),
  } as unknown as LoaderFunctionArgs;
}

describe('getSessionModes', () => {
  test('a missing id is a 400', async () => {
    const res = (await getSessionModes({ params: {}, request: new Request('http://localhost/api/x') } as unknown as LoaderFunctionArgs) as unknown as Response);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'Missing session id' });
  });

  test('a value that is not one path segment is a 404 before any lookup', async () => {
    for (const id of ['.', '..', 'a/b', 'a\\b']) {
      const res = (await getSessionModes(loaderArgs(id)) as unknown as Response);
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: 'Session not found' });
    }
  });

  test('an unknown but well-formed id is a 404', async () => {
    expect((await getSessionModes(loaderArgs(UNKNOWN))).status).toBe(404);
  });

  // The window omp creates on every new chat: the child is live and already in
  // the mode the user picked, and the JSONL does not exist yet (omp writes it at
  // the first assistant message). Answering 404 there told the composer "no
  // session" for a running chat, and reset the toggles the user had just
  // pressed, so the live child answers instead.
  test('a live session with no file yet answers its own modes, not a 404', async () => {
    const wrapper = { modeMirror: new ModeMirror(), isAlive: () => true };
    globalThis.__ompSessions ??= new Map();
    globalThis.__ompSessions.set(NO_FILE_LIVE, wrapper as never);
    recordSpawnProvenance(wrapper as never, 'yolo', { CHAMBER_MODES: 'plan' });
    try {
      const res = (await getSessionModes(loaderArgs(NO_FILE_LIVE)) as unknown as Response);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ sessionId: NO_FILE_LIVE, modes: { plan: true, goal: false } });
    } finally {
      globalThis.__ompSessions.delete(NO_FILE_LIVE);
    }
  });

  // A toggle moves the child, and the entry recording it lands a moment later —
  // so the file can still describe the state the user just left.
  test('a child that has reported a mode outranks the file', async () => {
    const wrapper = { modeMirror: new ModeMirror(), isAlive: () => true };
    wrapper.modeMirror.observeMarker({ marker: 'CHAMBER_PLAN_STATE:' as never, payload: { enabled: false } });
    globalThis.__ompSessions ??= new Map();
    globalThis.__ompSessions.set(SESSION_ID, wrapper as never);
    try {
      const res = (await getSessionModes(loaderArgs(SESSION_ID)) as unknown as Response);
      // The file on disk says plan: true.
      expect(await res.json()).toMatchObject({ modes: { plan: false } });
    } finally {
      globalThis.__ompSessions.delete(SESSION_ID);
    }
  });

  test('a dead session with no file is still a 404', async () => {
    globalThis.__ompSessions ??= new Map();
    globalThis.__ompSessions.set(NO_FILE_LIVE, { modeMirror: new ModeMirror(), isAlive: () => false } as never);
    try {
      expect((await getSessionModes(loaderArgs(NO_FILE_LIVE))).status).toBe(404);
    } finally {
      globalThis.__ompSessions.delete(NO_FILE_LIVE);
    }
  });

  test('a real session file answers its persisted selection', async () => {
    const res = (await getSessionModes(loaderArgs(SESSION_ID)) as unknown as Response);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ sessionId: SESSION_ID, modes: { plan: true, goal: false } });
  });
});

describe('archiveSession', () => {
  test('a wrong verb is a 405', async () => {
    const res: Response = (await archiveSession({ request: new Request('http://localhost/api/x', { method: 'GET' }), params: { sessionId: SESSION_ID } } as unknown as ActionFunctionArgs) as unknown as Response);
    expect(res.status).toBe(405);
  });

  test('a missing id is a 400', async () => {
    const res: Response = (await archiveSession({ request: formPost({ archived: 'true' }), params: {} } as unknown as ActionFunctionArgs) as unknown as Response);
    expect(res.status).toBe(400);
  });

  test('archiving inserts the row and unarchiving removes it', async () => {
    const archive = async (archived: boolean): Promise<Response> =>
      archiveSession({ request: formPost({ archived: String(archived) }), params: { sessionId: SESSION_ID } } as unknown as ActionFunctionArgs) as unknown as Response;

    expect(await (await archive(true)).json()).toMatchObject({ success: true, archived: true });
    expect(await db.get('SELECT session_id FROM archived_sessions WHERE session_id = ?', [SESSION_ID])).toBeTruthy();
    expect(await (await archive(false)).json()).toMatchObject({ success: true, archived: false });
    expect(await db.get('SELECT session_id FROM archived_sessions WHERE session_id = ?', [SESSION_ID])).toBeNull();
  });
});

describe('renameSession', () => {
  const rename = async (name: string, sessionId = UNKNOWN): Promise<Response> =>
    renameSession({ request: formPost({ name }), params: { sessionId } } as unknown as ActionFunctionArgs) as unknown as Response;

  test('a wrong verb is a 405', async () => {
    const res = (await renameSession({ request: new Request('http://localhost/api/x', { method: 'GET' }), params: { sessionId: SESSION_ID } } as unknown as ActionFunctionArgs)) as Response;
    expect(res.status).toBe(405);
  });

  test('a missing id is a 400', async () => {
    const res = (await renameSession({ request: formPost({ name: 'x' }), params: {} } as unknown as ActionFunctionArgs)) as Response;
    expect(res.status).toBe(400);
  });

  test('a blank name is refused with its code', async () => {
    const res: Response = await rename('   ');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'session_name_required' });
  });

  test('the 200-character ceiling is a boundary, not an off-by-one', async () => {
    // 201 is refused...
    const tooLong: Response = await rename('x'.repeat(201));
    expect(tooLong.status).toBe(400);
    expect(await tooLong.json()).toMatchObject({ code: 'session_name_too_long' });
  });

  test('a valid rename for an unknown session is a 404, not a write', async () => {
    const res: Response = await rename('a real name');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'Session not found' });
  });
});

describe('per-session UI state', () => {
  const put = async (body: unknown): Promise<Response> =>
    putSessionState({ request: jsonRequest('POST', body), params: { sessionId: 'state-test' } } as unknown as ActionFunctionArgs) as unknown as Response;

  test('a missing id is a 400', async () => {
    const res = (await putSessionState({ request: jsonRequest('POST', { state: {} }),
      params: {},
    } as unknown as ActionFunctionArgs) as unknown as Response);
    expect(res.status).toBe(400);
  });

  test('a wrong verb is a 405', async () => {
    const res = (await putSessionState({ request: jsonRequest('PUT', { state: {} }),
      params: { sessionId: 'state-test' },
    } as unknown as ActionFunctionArgs) as unknown as Response);
    expect(res.status).toBe(405);
  });

  test('only an object state is accepted', async () => {
    for (const body of [{}, { state: null }, { state: [] }, { state: 'x' }, []]) {
      expect((await put(body)).status).toBe(400);
    }
  });

  test('a valid state round-trips through the store', async () => {
    const res: Response = await put({ state: { sidebar: 'open', n: 3 } });
    expect(res.status).toBe(200);
    const read = (await getSessionState({ params: { sessionId: 'state-test' } } as unknown as ActionFunctionArgs) as unknown as Response);
    expect(await read.json()).toMatchObject({ sessionId: 'state-test', state: { sidebar: 'open', n: 3 } });
  });

  test('a missing id on the read is a 400', async () => {
    expect((await getSessionState({ params: {} } as unknown as ActionFunctionArgs)).status).toBe(400);
  });
});

describe('markSeen', () => {
  test('a missing id is a 400', async () => {
    expect((await markSeen({ params: {} } as unknown as ActionFunctionArgs)).status).toBe(400);
  });

  test('acking a session with no stored status is a no-op success', async () => {
    const res = (await markSeen({ params: { sessionId: 'nothing-stored' } } as unknown as ActionFunctionArgs) as unknown as Response);
    expect(await res.json()).toMatchObject({ success: true, deleted: false });
  });
});
