/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `/api/review` — the annotation contract.
 *
 * What is pinned is what a silent wrong answer would cost: a save that replaces
 * instead of stacking (a block carries ONE judgement), a delete that answers
 * success for an id that does not exist (the caller would believe the mark is
 * gone), a body the server never validates (a note reaching SQLite as an
 * object), and a repo that escapes its root (two documents sharing one scope).
 *
 * The database is a temp SQLite file, never the developer's — the same
 * `isolateDb` rule every database-touching suite follows.
 */

import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { getDb } from '@/server/db.server';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { removeDir } from '@/test-support/remove-dir';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { action, loader } from '@/server/routes/review/index';

const ROOT = path.join(os.tmpdir(), `kabmo-review-route-${process.pid}`);

function request(method: string, url: string, body?: unknown): Request {
  return new Request(`http://localhost${url}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function get(query: string) {
  const response = (await loader({ request: request('GET', `/api/review?${query}`) } as LoaderFunctionArgs)) as Response;
  return { status: response.status, body: (await response.json()) as Record<string, any> };
}

async function call(method: 'POST' | 'DELETE', url: string, body?: unknown) {
  const response = (await action({ request: request(method, url, body) } as ActionFunctionArgs)) as Response;
  return { status: response.status, body: (await response.json()) as Record<string, any> };
}

const target = { path: 'NOTES.md', root: ROOT, repo: '.' };

beforeEach(async () => {
  fs.mkdirSync(path.join(ROOT, 'nested'), { recursive: true });
  await isolateDb();
  // `resolveRoot` only accepts an allow-listed directory (the app root, a
  // dropped-in root, or a REGISTERED workspace), so a temp directory has to be
  // registered exactly as the UI's own folder creation would register it —
  // otherwise every scope in this suite silently falls back to the app root and
  // the assertions below would pass for the wrong reason.
  const db = await getDb();
  await db.run('INSERT INTO workspace_folders (name, project_path) VALUES (?, ?)', ['review-test', ROOT]);
});

afterAll(async () => {
  await releaseDb();
  removeDir(ROOT);
});

describe('POST /api/review', () => {
  test('a save is readable back under the resolved scope', async () => {
    const saved = await call('POST', '/api/review', {
      ...target,
      blockKey: 'paragraph:abc#1',
      lineStart: 3,
      lineEnd: 4,
      verdict: 'needs-work',
      note: 'stale',
      quote: 'Some paragraph',
    });
    expect(saved.status).toBe(200);
    expect(saved.body.annotation).toMatchObject({ blockKey: 'paragraph:abc#1', verdict: 'needs-work', note: 'stale' });

    const listed = await get(`path=NOTES.md&root=${encodeURIComponent(ROOT)}&repo=.`);
    expect(listed.status).toBe(200);
    expect(listed.body.annotations).toHaveLength(1);
    // The scope is the resolved pair, not the raw `root` as sent.
    expect(listed.body.scope).toBe(`${ROOT}\u0000.`);
  });

  test('a second judgement on the SAME block replaces the first', async () => {
    const base = { ...target, blockKey: 'paragraph:abc#1', lineStart: 3, lineEnd: 3, quote: 'x' };
    await call('POST', '/api/review', { ...base, verdict: 'needs-work', note: 'wrong' });
    const second = await call('POST', '/api/review', { ...base, verdict: 'good', note: 'fixed' });

    expect(second.body.annotation.note).toBe('fixed');
    const listed = await get(`path=NOTES.md&root=${encodeURIComponent(ROOT)}`);
    expect(listed.body.annotations).toHaveLength(1);
    expect(listed.body.annotations[0].verdict).toBe('good');
    // `created_at` survives the replace, so "when was this first judged" stays
    // answerable; `updated_at` moves.
    expect(listed.body.annotations[0].createdAt).toBe(second.body.annotation.createdAt);
  });

  test('two paths and two scopes never see each other', async () => {
    const body = { blockKey: 'paragraph:abc#1', lineStart: 1, lineEnd: 1, verdict: 'good', note: '', quote: '' };
    await call('POST', '/api/review', { ...body, path: 'A.md', root: ROOT });
    await call('POST', '/api/review', { ...body, path: 'B.md', root: ROOT });
    await call('POST', '/api/review', { ...body, path: 'A.md', root: ROOT, repo: 'nested' });

    const a = await get(`path=A.md&root=${encodeURIComponent(ROOT)}`);
    const nested = await get(`path=A.md&root=${encodeURIComponent(ROOT)}&repo=nested`);
    expect(a.body.annotations).toHaveLength(1);
    expect(nested.body.annotations).toHaveLength(1);
    expect(a.body.scope).not.toBe(nested.body.scope);
  });

  test('a bad verdict, a missing blockKey and a missing path are 400s with reasons', async () => {
    const badVerdict = await call('POST', '/api/review', { ...target, blockKey: 'k', verdict: 'meh' });
    expect(badVerdict.status).toBe(400);
    expect(badVerdict.body.error).toContain('verdict');

    const noKey = await call('POST', '/api/review', { ...target, verdict: 'good' });
    expect(noKey.status).toBe(400);
    expect(noKey.body.error).toContain('blockKey');

    const noPath = await call('POST', '/api/review', { verdict: 'good', blockKey: 'k' });
    expect(noPath.status).toBe(400);
    expect(noPath.body.error).toContain('path');
  });

  test('an unregistered root falls back to the server default, never to the path sent', async () => {
    const unregistered = path.join(os.tmpdir(), `kabmo-not-a-workspace-${process.pid}`);
    fs.mkdirSync(unregistered, { recursive: true });
    const listed = await get(`path=NOTES.md&root=${encodeURIComponent(unregistered)}`);
    expect(listed.status).toBe(200);
    expect(listed.body.scope).not.toContain(unregistered);
    removeDir(unregistered);
  });

  test('a repo outside the root is refused, not silently scoped elsewhere', async () => {
    const response = await call('POST', '/api/review', {
      ...target,
      repo: '../../etc',
      blockKey: 'k',
      verdict: 'good',
    });
    expect(response.status).toBe(403);
  });

  test('a non-positive line number is stored as 0 rather than corrupting the row', async () => {
    const saved = await call('POST', '/api/review', {
      ...target,
      blockKey: 'k',
      lineStart: -4,
      lineEnd: 2.5,
      verdict: 'good',
    });
    expect(saved.body.annotation.lineStart).toBe(0);
    expect(saved.body.annotation.lineEnd).toBe(0);
  });
});

describe('DELETE /api/review', () => {
  test('removes the row, and an unknown id is a 404 rather than a success', async () => {
    const saved = await call('POST', '/api/review', { ...target, blockKey: 'k', verdict: 'good' });
    const id = saved.body.annotation.id as string;

    const removed = await call('DELETE', `/api/review?id=${id}`);
    expect(removed.status).toBe(200);
    expect((await get(`path=NOTES.md&root=${encodeURIComponent(ROOT)}`)).body.annotations).toHaveLength(0);

    const again = await call('DELETE', `/api/review?id=${id}`);
    expect(again.status).toBe(404);
  });

  test('a missing id is a 400', async () => {
    const response = await call('DELETE', '/api/review');
    expect(response.status).toBe(400);
  });
});

describe('the route owns its verbs', () => {
  test('an unsupported method answers 405, not a phantom success', async () => {
    const response = await action({ request: request('PUT', '/api/review', {}) } as ActionFunctionArgs);
    expect((response as Response).status).toBe(405);
  });

  test('a GET without a path is a 400', async () => {
    expect((await get('')).status).toBe(400);
  });
});
