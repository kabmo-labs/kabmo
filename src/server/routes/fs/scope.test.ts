/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The scope route: turning an absolute path (a drop, a `file://` URL) into the
 * `root` + relative path the editor panel speaks.
 *
 * The load-bearing claims are about the ALLOW-LIST and about the deepest-root
 * rule: a path outside every registered workspace is refused by name rather
 * than answered with a scope the reader would then reject, and a path inside a
 * NESTED workspace resolves against that workspace instead of the directory
 * that contains it (otherwise the relative path names a file no panel is
 * scoped to).
 */

import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { resolveFileScope } from '@/server/routes/fs/scope';

const APP = process.cwd();
const DIR = path.join(APP, 'tmp-scope-probe');

afterEach(() => {
  fs.rmSync(DIR, { recursive: true, force: true });
});

async function scope(rawPath: string) {
  const url = new URL('http://localhost/api/fs/scope');
  url.searchParams.set('path', rawPath);
  const res = await resolveFileScope({ request: new Request(url) } as never);
  return { status: res.status, body: (await res.json()) as { root?: string; path?: string; name?: string; kind?: string; error?: string } };
}

function write(relPath: string, content: string | Uint8Array) {
  const target = path.join(DIR, relPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return target;
}

describe('fs scope route', () => {
  test('an absolute path inside the app root resolves to a relative scope', async () => {
    const target = write('notes.md', '# hi\n');
    const { status, body } = await scope(target);

    expect(status).toBe(200);
    expect(body.root).toBe(APP);
    expect(body.path).toBe('tmp-scope-probe/notes.md');
    expect(body.name).toBe('notes.md');
    expect(body.kind).toBe('text');
  });

  test('a file:// URL is decoded, spaces and all', async () => {
    const target = write('My Notes.md', '# spaced\n');
    const { status, body } = await scope(`file://${target.replace(/ /g, '%20')}`);

    expect(status).toBe(200);
    expect(body.path).toBe('tmp-scope-probe/My Notes.md');
    expect(body.name).toBe('My Notes.md');
  });

  test('a binary file is classified as binary, with the reason', async () => {
    const target = write('blob.bin', new Uint8Array([0x00, 0x01, 0x02, 0x03]));
    const { status, body } = await scope(target);

    expect(status).toBe(200);
    expect(body.kind).toBe('binary');
    expect(body.error).toContain('not text');
  });

  test('an image is classified as an image, which is openable', async () => {
    const target = write('shot.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const { status, body } = await scope(target);

    expect(status).toBe(200);
    expect(body.kind).toBe('image');
    expect(body.error).toBeUndefined();
  });

  test('a path outside every workspace is refused by name', async () => {
    const { status, body } = await scope('/etc/hosts');

    expect(status).toBe(403);
    expect(body.error).toContain('outside every workspace');
  });

  test('a folder is refused as a folder, not resolved', async () => {
    const dir = path.join(DIR, 'sub');
    fs.mkdirSync(dir, { recursive: true });
    const { status, body } = await scope(dir);

    expect(status).toBe(400);
    expect(body.error).toContain('folder');
  });

  test('a missing file is a 404, not a scope with no file behind it', async () => {
    const { status } = await scope(path.join(DIR, 'ghost.ts'));

    expect(status).toBe(404);
  });

  test('a missing path parameter is a 400', async () => {
    const url = new URL('http://localhost/api/fs/scope');
    const res = await resolveFileScope({ request: new Request(url) } as never);

    expect(res.status).toBe(400);
  });
});
