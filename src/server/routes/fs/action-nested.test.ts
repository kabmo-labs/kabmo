/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Nested paths at the route: a create and a rename that name SEGMENTS.
 *
 * The Files panel's dialogs used to accept one segment, so `lib/parse.ts` was
 * unreachable from the UI — the user had to create `lib`, expand it, then the
 * file. Both actions now take a relative path, and the rules that keep that
 * inside the folder the user named are asserted here because they are the whole
 * reason a nested path is safe:
 *
 * - a `..` SEGMENT is refused even when it would land back inside the root
 *   (`a/../b.ts` resolves there), so the refusal is about the path the user
 *   typed rather than about where it happened to land;
 * - an ABSOLUTE path is refused, because `path.join(dir, abs)` discards the
 *   folder the dialog showed;
 * - a rename resolves against the LISTED root, not the workspace root — a
 *   rename inside a nested repo used to resolve to a path outside the repo;
 * - a rename never overwrites an existing destination, and never moves a folder
 *   into its own subtree.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { action } from '@/server/routes/fs/action';

/** Probes live in the repo root — the one directory the root allow-list always accepts. */
const DIR = path.join(process.cwd(), 'tmp-nested-probe');

function reset(files: Record<string, string> = {}): void {
  fs.rmSync(DIR, { recursive: true, force: true });
  fs.mkdirSync(DIR, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(DIR, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}

afterEach(() => {
  fs.rmSync(DIR, { recursive: true, force: true });
});

async function post(fields: Record<string, string>) {
  const form = new FormData();
  form.append('root', process.cwd());
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  const res = await action({ request: new Request('http://localhost/api/fs/action', { method: 'POST', body: form }) } as never);
  return { status: res.status, body: (await res.json()) as { success?: boolean; kind?: string; path?: string; previousPath?: string; error?: string } };
}

describe('fs create with a nested path', () => {
  test('creates every directory that leads to the file', async () => {
    reset();

    const { status, body } = await post({ actionType: 'create', path: 'tmp-nested-probe', name: 'lib/deep/parse.ts' });

    expect(status).toBe(200);
    expect(body).toEqual({ success: true, kind: 'file', path: 'tmp-nested-probe/lib/deep/parse.ts' });
    expect(fs.readFileSync(path.join(DIR, 'lib/deep/parse.ts'), 'utf8')).toBe('');
  });

  test('creates a FOLDER when asked, and reports the kind back', async () => {
    reset();

    const { status, body } = await post({ actionType: 'create', path: 'tmp-nested-probe', name: 'a/b', kind: 'folder' });

    expect(status).toBe(200);
    expect(body).toEqual({ success: true, kind: 'folder', path: 'tmp-nested-probe/a/b' });
    expect(fs.statSync(path.join(DIR, 'a/b')).isDirectory()).toBe(true);
  });

  test('normalizes a backslash and repeated separators into one path', async () => {
    reset();

    const { body } = await post({ actionType: 'create', path: 'tmp-nested-probe', name: 'x\\\\y//z.ts' });

    expect(body.path).toBe('tmp-nested-probe/x/y/z.ts');
    expect(fs.existsSync(path.join(DIR, 'x/y/z.ts'))).toBe(true);
  });

  test('refuses a .. segment even when it would land inside the root', async () => {
    reset({ 'keep/.gitkeep': '' });

    // `keep/../escape.ts` resolves inside the probe directory, so a containment
    // check alone would accept it — the refusal is about the path as typed.
    const { status, body } = await post({ actionType: 'create', path: 'tmp-nested-probe', name: 'keep/../escape.ts' });

    expect(status).toBe(400);
    expect(body.error).toContain('..');
    expect(fs.existsSync(path.join(DIR, 'escape.ts'))).toBe(false);
  });

  test('refuses an absolute path', async () => {
    reset();

    for (const name of ['/tmp/absolute.ts', 'C:/absolute.ts', 'C:relative.ts']) {
      expect((await post({ actionType: 'create', path: 'tmp-nested-probe', name })).status).toBe(400);
    }
  });

  test('refuses a nested path whose final entry already exists', async () => {
    reset({ 'lib/parse.ts': 'keep me' });

    const { status, body } = await post({ actionType: 'create', path: 'tmp-nested-probe', name: 'lib/parse.ts' });

    expect(status).toBe(409);
    expect(body.error).toContain('already exists');
    expect(fs.readFileSync(path.join(DIR, 'lib/parse.ts'), 'utf8')).toBe('keep me');
  });
});

describe('fs rename with a nested path', () => {
  test('renames into a new nested folder, creating its parents', async () => {
    reset({ 'a.ts': 'A' });

    const { status, body } = await post({ actionType: 'rename', path: 'tmp-nested-probe/a.ts', newPath: 'tmp-nested-probe/lib/deep/a.ts' });

    expect(status).toBe(200);
    expect(body).toEqual({ success: true, path: 'tmp-nested-probe/lib/deep/a.ts', previousPath: 'tmp-nested-probe/a.ts' });
    expect(fs.existsSync(path.join(DIR, 'a.ts'))).toBe(false);
    expect(fs.readFileSync(path.join(DIR, 'lib/deep/a.ts'), 'utf8')).toBe('A');
  });

  test('a plain rename inside one folder keeps its siblings', async () => {
    reset({ 'src/a.ts': 'A', 'src/b.ts': 'B' });

    const { body } = await post({ actionType: 'rename', path: 'tmp-nested-probe/src/a.ts', newPath: 'tmp-nested-probe/src/c.ts' });

    expect(body.path).toBe('tmp-nested-probe/src/c.ts');
    expect(fs.existsSync(path.join(DIR, 'src/b.ts'))).toBe(true);
  });

  test('refuses an existing destination instead of clobbering it', async () => {
    reset({ 'a.ts': 'A', 'b.ts': 'B' });

    const { status, body } = await post({ actionType: 'rename', path: 'tmp-nested-probe/a.ts', newPath: 'tmp-nested-probe/b.ts' });

    expect(status).toBe(409);
    expect(body.error).toContain('already exists');
    expect(fs.readFileSync(path.join(DIR, 'b.ts'), 'utf8')).toBe('B');
  });

  test('refuses moving a folder into its own subtree', async () => {
    reset({ 'src/a.ts': 'A' });

    const { status, body } = await post({ actionType: 'rename', path: 'tmp-nested-probe/src', newPath: 'tmp-nested-probe/src/deep' });

    expect(status).toBe(400);
    expect(body.error).toContain('inside itself');
    expect(fs.existsSync(path.join(DIR, 'src/a.ts'))).toBe(true);
  });

  test('refuses a .. segment and an absolute destination', async () => {
    reset({ 'a.ts': 'A' });

    expect((await post({ actionType: 'rename', path: 'tmp-nested-probe/a.ts', newPath: 'tmp-nested-probe/../out.ts' })).status).toBe(400);
    expect((await post({ actionType: 'rename', path: 'tmp-nested-probe/a.ts', newPath: '/tmp/out.ts' })).status).toBe(400);
    expect(fs.existsSync(path.join(DIR, 'a.ts'))).toBe(true);
  });

  test('renaming to the same path is a no-op that still reports both ends', async () => {
    reset({ 'a.ts': 'A' });

    const { status, body } = await post({ actionType: 'rename', path: 'tmp-nested-probe/a.ts', newPath: 'tmp-nested-probe/a.ts' });

    expect(status).toBe(200);
    expect(body.path).toBe('tmp-nested-probe/a.ts');
    expect(fs.readFileSync(path.join(DIR, 'a.ts'), 'utf8')).toBe('A');
  });

  test('a missing source is refused rather than creating an empty entry', async () => {
    reset();

    const { status } = await post({ actionType: 'rename', path: 'tmp-nested-probe/gone.ts', newPath: 'tmp-nested-probe/here.ts' });

    expect(status).toBe(404);
    expect(fs.existsSync(path.join(DIR, 'here.ts'))).toBe(false);
  });
});
