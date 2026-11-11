/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The editor's disk-digest probe.
 *
 * The rules that matter are the ones an mtime cannot express: a file rewritten
 * with the SAME bytes answers the same hash (so a `touch` or a no-op formatter
 * never replaces a buffer), a file whose bytes changed answers a different one,
 * and a path outside the root allow-list is refused rather than answered.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { fileDigest } from '@/server/routes/fs/digest';
import { contentHash } from '@/shared/lib/fs/content-hash';

const PROBE = path.join(process.cwd(), 'tmp-digest-probe.txt');
const NESTED = path.join(process.cwd(), 'tmp-digest-repo');

afterEach(() => {
  fs.rmSync(PROBE, { recursive: true, force: true });
  fs.rmSync(NESTED, { recursive: true, force: true });
});

async function digest(filePath: string, root: string = process.cwd(), repo?: string) {
  const url = new URL('http://localhost/api/fs/digest');
  url.searchParams.set('path', filePath);
  url.searchParams.set('root', root);
  if (repo) url.searchParams.set('repo', repo);
  const res = await fileDigest({ request: new Request(url) } as never);
  return {
    status: res.status,
    body: (await res.json()) as { exists?: boolean; mtimeMs?: number | null; hash?: string | null; error?: string },
  };
}

describe('fs digest', () => {
  test('a file answers the hash of its content', async () => {
    fs.writeFileSync(PROBE, 'const a = 1;\n');
    const { status, body } = await digest('tmp-digest-probe.txt');

    expect(status).toBe(200);
    expect(body.exists).toBe(true);
    expect(body.hash).toBe(await contentHash('const a = 1;\n'));
    expect(typeof body.mtimeMs).toBe('number');
  });

  test('a file rewritten with the SAME bytes keeps its hash, however far the mtime moved', async () => {
    fs.writeFileSync(PROBE, 'same bytes\n');
    const first = await digest('tmp-digest-probe.txt');

    // A `touch`, a formatter that changed nothing, a checkout of the revision
    // already open: the clock moves, the bytes do not.
    const later = new Date(Date.now() + 5_000);
    fs.utimesSync(PROBE, later, later);
    const second = await digest('tmp-digest-probe.txt');

    expect(second.body.hash).toBe(first.body.hash);
    expect(second.body.mtimeMs).not.toBe(first.body.mtimeMs);
  });

  test('changed bytes answer a different hash', async () => {
    fs.writeFileSync(PROBE, 'one\n');
    const first = await digest('tmp-digest-probe.txt');
    fs.writeFileSync(PROBE, 'two, and longer\n');
    const second = await digest('tmp-digest-probe.txt');

    expect(second.body.hash).not.toBe(first.body.hash);
  });

  test('a missing file is not a digest', async () => {
    const { status, body } = await digest('tmp-digest-probe.txt');
    expect(status).toBe(200);
    expect(body.exists).toBe(false);
    expect(body.hash).toBeNull();
  });

  test('a directory standing in the file’s place is not the file', async () => {
    fs.mkdirSync(PROBE, { recursive: true });
    const { body } = await digest('tmp-digest-probe.txt');
    expect(body.exists).toBe(false);
  });

  test('a path outside the root allow-list is refused', async () => {
    const { status, body } = await digest('../../etc/passwd');
    expect(status).toBe(403);
    expect(body.error).toBe('Invalid path');
  });

  test('the scope travels with the probe, so a nested repo is read from its own tree', async () => {
    fs.mkdirSync(NESTED, { recursive: true });
    fs.writeFileSync(path.join(NESTED, 'a.txt'), 'nested\n');
    const { body } = await digest('a.txt', process.cwd(), 'tmp-digest-repo');
    expect(body.hash).toBe(await contentHash('nested\n'));
  });
});
