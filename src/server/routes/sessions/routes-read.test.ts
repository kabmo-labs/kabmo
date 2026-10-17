/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/** The session route group's read-only tail: the subagent roster, the
 * folder listing, and the sidebar list. Split verbatim from `routes.test.ts`
 * so both files stay under the repo's 350-line ceiling; the shared env/db
 * setup and response helpers it needs are carried over with it. */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getDb } from '@/server/db.server';
import type { ActionFunctionArgs } from '@/server/lib/remix-compat';
import { clearSessionFileCaches } from '@/server/lib/omp/session/files';
import { invalidateOmpSidebarData } from '@/server/lib/omp/session/reader';
import { listSubagents, readSubagentTranscript } from '@/server/routes/sessions/subagents';
import { loader as folderSessions } from '@/server/routes/sessions/folder';
import { loader as sidebarList } from '@/server/routes/sessions/list';
import { removeDir } from '@/test-support/remove-dir';

// `tmpdir()`, not `/tmp`: there is no `/tmp` on Windows, so the literal
// resolved against the current drive and the tree was never where the suite
// (or the delete) looked for it.
const ROOT = path.join(os.tmpdir(), `omc-sessions-routes-read-${process.pid}`);
const AGENT = path.join(ROOT, 'agent');
const SESSION_ID = '11111111-2222-3333-4444-555555555555';

let db: Awaited<ReturnType<typeof getDb>>;
let priorDbPath: string | undefined;
let priorMock: string | undefined;
let priorAgentDir: string | undefined;
let priorSlot: typeof globalThis.__ompChamberDb;

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
  priorDbPath = Bun.env.OMPCHAMBER_DB_PATH;
  priorMock = Bun.env.MOCK;
  priorSlot = globalThis.__ompChamberDb;

  Bun.env.PI_CODING_AGENT_DIR = AGENT;
  Bun.env.OMPCHAMBER_DB_PATH = path.join(ROOT, 'db.sqlite');
  Bun.env.MOCK = 'false';
  // The db handle is process-wide; drop any handle a sibling suite opened so
  // this file resolves the temp path, and leave the temp file on disk so a
  // later suite that inherits the slot cannot fall back to the real database.
  globalThis.__ompChamberDb = undefined;
  clearSessionFileCaches();
  invalidateOmpSidebarData();
  db = await getDb();
});

afterAll(() => {
  clearSessionFileCaches();
  invalidateOmpSidebarData();
  if (priorAgentDir === undefined) delete Bun.env.PI_CODING_AGENT_DIR;
  else Bun.env.PI_CODING_AGENT_DIR = priorAgentDir;
  if (priorDbPath === undefined) delete Bun.env.OMPCHAMBER_DB_PATH;
  else Bun.env.OMPCHAMBER_DB_PATH = priorDbPath;
  if (priorMock === undefined) delete Bun.env.MOCK;
  else Bun.env.MOCK = priorMock;
  // Close before restoring the slot and deleting: a live connection makes a
  // Windows delete fail with EBUSY, and a throw from `afterAll` reports a
  // failure of the file.
  globalThis.__ompChamberDb?.resolved?.raw.close();
  globalThis.__ompChamberDb = priorSlot;
  removeDir(ROOT);
});

function arrayOf(body: unknown, key: string): unknown[] {
  if (!body || typeof body !== 'object' || !(key in body)) throw new Error(`response has no ${key}`);
  const value: unknown = body[key as keyof typeof body];
  if (!Array.isArray(value)) throw new Error(`${key} is not an array`);
  return value;
}

function textOf(row: unknown, key: string): string {
  if (!row || typeof row !== 'object' || !(key in row)) throw new Error(`row has no ${key}`);
  const value: unknown = row[key as keyof typeof row];
  if (typeof value !== 'string') throw new Error(`row.${key} is not a string`);
  return value;
}

describe('subagents', () => {
  test('a missing session id is a 400', async () => {
    expect((await listSubagents({ params: {} } as unknown as ActionFunctionArgs)).status).toBe(400);
  });

  test('an unknown session yields an empty roster, never a 404', async () => {
    const res = (await listSubagents({ params: { sessionId: 'no-such-session' } } as unknown as ActionFunctionArgs) as unknown as Response);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ subagents: [] });
  });

  test('a transcript request needs both ids', async () => {
    const res = (await readSubagentTranscript({
      request: new Request('http://localhost/api/x'),
      params: { sessionId: SESSION_ID },
    } as unknown as ActionFunctionArgs) as unknown as Response);
    expect(res.status).toBe(400);
  });

  test('a malformed subagent id is refused before the filesystem', async () => {
    for (const subagentId of ['a/b', 'a\\b', '.', '..', 'x'.repeat(101)]) {
      const res = (await readSubagentTranscript({
        request: new Request('http://localhost/api/x'),
        params: { sessionId: SESSION_ID, subagentId },
      } as unknown as ActionFunctionArgs) as unknown as Response);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'invalid_subagent_id' });
    }
  });

  test('a valid but unknown subagent has no transcript page', async () => {
    const res = (await readSubagentTranscript({
      request: new Request('http://localhost/api/x'),
      params: { sessionId: SESSION_ID, subagentId: 'AlphaBeta' },
    } as unknown as ActionFunctionArgs) as unknown as Response);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ page: null });
  });
});

describe('folder session listing', () => {
  test('returns exactly the sessions of the named folder', async () => {
    const folder = await db.run('INSERT INTO workspace_folders (name) VALUES (?)', ['Route WS']);
    await db.run('INSERT INTO sessions (folder_id, title) VALUES (?, ?)', [folder.lastID, 'A']);
    await db.run('INSERT INTO sessions (folder_id, title) VALUES (?, ?)', [folder.lastID, 'B']);
    const other = await db.run('INSERT INTO workspace_folders (name) VALUES (?)', ['Other WS']);
    await db.run('INSERT INTO sessions (folder_id, title) VALUES (?, ?)', [other.lastID, 'C']);

    const res = (await folderSessions({ params: { sessionId: String(folder.lastID) } } as unknown as ActionFunctionArgs) as unknown as Response);
    const titles = arrayOf(await res.json(), 'sessions').map((row) => textOf(row, 'title'));
    expect(titles.sort()).toEqual(['A', 'B']);
  });
});

describe('sidebar session list', () => {
  test('answers folders and the mock flag without a live omp install', async () => {
    const res = (await sidebarList({} as unknown as ActionFunctionArgs) as unknown as Response);
    expect(await res.json()).toMatchObject({ isMock: false, folders: expect.any(Array) });
  });
});
