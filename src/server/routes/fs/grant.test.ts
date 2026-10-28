/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `POST /api/fs/grant` — the one route that lets a DROP widen what the console
 * may read.
 *
 * Every case here is a security property, and each fails silently in the app:
 * a grant that fires for a cross-origin request, or one that names a directory
 * instead of a file, still opens the tab the user asked for — it just also
 * hands out more than the gesture meant.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { action } from '@/server/routes/fs/grant';
import { resolveFileScope } from '@/server/routes/fs/scope';
import { clearExternalRoots, externalRoots, isExternalRoot } from '@/server/lib/fs/external-roots';

/** A file OUTSIDE the app root and outside every workspace. */
let outside: string;
let outsideFile: string;

beforeEach(() => {
  clearExternalRoots();
  outside = fs.mkdtempSync(path.join(os.tmpdir(), 'kabmo-grant-'));
  outsideFile = path.join(outside, 'report.md');
  fs.writeFileSync(outsideFile, '# report\n');
});

afterEach(() => {
  clearExternalRoots();
  fs.rmSync(outside, { recursive: true, force: true });
});

function grantRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/fs/grant', {
    method: 'POST',
    headers: { 'content-type': 'application/json', host: 'localhost', ...headers },
    body: JSON.stringify(body),
  });
}

/** The `code` on a refusal body, narrowed rather than asserted. */
function refusalCode(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('code' in body)) return null;
  return typeof body.code === 'string' ? body.code : null;
}

async function grant(body: unknown, headers: Record<string, string> = {}) {
  const res = await action({ request: grantRequest(body, headers) } as never);
  return { status: res.status, body: (await res.json()) as { root?: string; path?: string; name?: string; error?: string } };
}

describe('fs grant route', () => {
  test('a file outside every workspace is refused by scope, then granted', async () => {
    // The refusal the client retries on, and the reason the retry exists.
    const before = await resolveFileScope({
      request: new Request(`http://localhost/api/fs/scope?path=${encodeURIComponent(outsideFile)}`),
    } as never);
    expect(before.status).toBe(403);
    expect(refusalCode(await before.json())).toBe('outside_workspace');

    const granted = await grant({ path: outsideFile });
    expect(granted.status).toBe(200);
    expect(granted.body.root).toBe(outside);
    expect(granted.body.path).toBe('report.md');

    // And the SAME reference now resolves through the ordinary route, which is
    // what makes the retry worth making.
    const after = await resolveFileScope({
      request: new Request(`http://localhost/api/fs/scope?path=${encodeURIComponent(outsideFile)}`),
    } as never);
    expect(after.status).toBe(200);
  });

  test('the grant is the file’s own DIRECTORY, not its parent', () => {
    return grant({ path: outsideFile }).then(() => {
      expect(isExternalRoot(outside)).toBe(true);
      expect(isExternalRoot(path.dirname(outside))).toBe(false);
      expect(externalRoots()).toEqual([path.resolve(outside)]);
    });
  });

  test('a folder is refused — a drop of a file is the gesture, and a tab needs one', async () => {
    const { status, body } = await grant({ path: outside });
    expect(status).toBe(400);
    expect(body.error).toContain('folder');
    expect(externalRoots()).toEqual([]);
  });

  test('a missing file is refused and grants nothing', async () => {
    const { status } = await grant({ path: path.join(outside, 'gone.md') });
    expect(status).toBe(404);
    expect(externalRoots()).toEqual([]);
  });

  test('a cross-origin request cannot grant', async () => {
    const { status } = await grant({ path: outsideFile }, { origin: 'https://evil.example' });
    expect(status).toBe(403);
    expect(externalRoots()).toEqual([]);
  });

  test('a same-origin request is accepted, and no Origin at all is too', async () => {
    const same = await grant({ path: outsideFile }, { origin: 'http://localhost' });
    expect(same.status).toBe(200);
    clearExternalRoots();
    // A request with no Origin is curl or a test, never a browser being tricked.
    const none = await grant({ path: outsideFile });
    expect(none.status).toBe(200);
  });

  test('a GET is refused — the verb is part of the gate', async () => {
    const res = await action({
      request: new Request('http://localhost/api/fs/grant', { method: 'GET' }),
    } as never);
    expect(res.status).toBe(405);
  });

  test('a relative path is refused', async () => {
    const { status } = await grant({ path: 'report.md' });
    expect(status).toBe(400);
    expect(externalRoots()).toEqual([]);
  });

  test('a file:// URL names the same file', async () => {
    const { status, body } = await grant({ path: `file://${outsideFile}` });
    expect(status).toBe(200);
    expect(body.path).toBe('report.md');
  });
});
