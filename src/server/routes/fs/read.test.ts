/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The read route's gate: which files it will hand back as TEXT.
 *
 * This is the one place a binary or oversized file can be stopped before it
 * reaches an editor buffer. It matters because the failure is not cosmetic —
 * the editor's buffer is empty after a refused read, and Save is only disabled
 * by `loadError`, so a route that answered mojibake left a buffer the next save
 * wrote straight back over the real file.
 *
 * The tests drive the real handler against real files on disk, because the
 * classification reads the file's leading bytes and its stat size.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { readFile } from '@/server/routes/fs/read';
import { EDITOR_MAX_FILE_BYTES } from '@/shared/lib/fs/file-kind';

const DIR = path.join(process.cwd(), 'tmp-read-gate');

afterEach(() => {
  fs.rmSync(DIR, { recursive: true, force: true });
});

async function read(relPath: string) {
  const url = new URL('http://localhost/api/fs/read');
  url.searchParams.set('path', relPath);
  url.searchParams.set('root', DIR);
  const res = await readFile({ request: new Request(url) } as never);
  return { status: res.status, body: (await res.json()) as { content?: string; error?: string; kind?: string } };
}

function write(relPath: string, bytes: Uint8Array | string) {
  const target = path.join(DIR, relPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
  return target;
}

describe('fs read gate', () => {
  test('a text file is returned as its content', async () => {
    write('notes.md', '# hello\n');
    const { status, body } = await read('notes.md');

    expect(status).toBe(200);
    expect(body.content).toBe('# hello\n');
  });

  test('an extensionless file with text bytes is still text', async () => {
    write('bin/run', '#!/bin/sh\necho hi\n');
    const { status, body } = await read('bin/run');

    expect(status).toBe(200);
    expect(body.content).toContain('echo hi');
  });

  test('a file with a NUL byte is refused as binary, with a reason', async () => {
    // A zip's own magic: PK\x03\x04. The NUL is what the sniff sees.
    write('archive.zip', new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]));
    const { status, body } = await read('archive.zip');

    expect(status).toBe(415);
    expect(body.kind).toBe('binary');
    expect(body.error).toContain('not text');
  });

  test('a NUL deep past the sniff window is NOT detected, and that is the trade', async () => {
    // 8 KiB of text, then a NUL. The head is what is inspected, so this reads
    // as text — a deliberate bound, pinned so a future change to the window is
    // a visible decision rather than an accident.
    const head = new Uint8Array(9000).fill(0x61);
    head[8500] = 0x00;
    write('late-nul.dat', head);
    const { status } = await read('late-nul.dat');

    expect(status).toBe(200);
  });

  test('a file over the ceiling is refused for size, naming both numbers', async () => {
    write('huge.log', new Uint8Array(EDITOR_MAX_FILE_BYTES + 1).fill(0x61));
    const { status, body } = await read('huge.log');

    expect(status).toBe(415);
    expect(body.kind).toBe('too-large');
    expect(body.error).toContain('5.00 MB');
  });

  test('an image is refused with the raw-route pointer, not the kind refusal', async () => {
    // The PNG signature is also a raster image by extension, so the image
    // branch wins before the binary sniff — the editor paints it, not refuses.
    write('shot.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]));
    const { status, body } = await read('shot.png');

    expect(status).toBe(400);
    expect(body.error).toContain('/api/fs/raw');
  });

  test('a directory is not a file, and is reported as not found', async () => {
    fs.mkdirSync(path.join(DIR, 'folder'), { recursive: true });
    const { status } = await read('folder');

    // `Bun.file().exists()` is false for a directory, so the not-found branch
    // answers first and the `isDirectory` check below it is unreachable for a
    // real folder. Pinned as the route's actual behavior rather than the
    // intended one, so a change here is visible.
    expect(status).toBe(404);
  });

  test('a path outside the root is refused', async () => {
    const url = new URL('http://localhost/api/fs/read');
    url.searchParams.set('path', '../../etc/passwd');
    url.searchParams.set('root', DIR);
    const res = await readFile({ request: new Request(url) } as never);

    expect(res.status).toBe(403);
  });
});
