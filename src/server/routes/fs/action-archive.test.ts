/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The archive and batch-delete actions at the route.
 *
 * The round trips are driven through the real `/api/fs/action` entry point, so
 * the scoped-root resolution, the JSON path list and the external tool all run
 * together. Cases that need a binary the machine lacks are skipped, not failed.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { action } from '@/server/routes/fs/action';

const DIR = path.join(process.cwd(), 'tmp-fs-archive-probe');

function reset(files: Record<string, string>): void {
  fs.rmSync(DIR, { recursive: true, force: true });
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
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const hasZip = Bun.which('zip') !== null && Bun.which('unzip') !== null;

describe('fs batch delete', () => {
  test('removes every path in one request', async () => {
    reset({ 'a.ts': 'A', 'src/b.ts': 'B', 'keep.ts': 'K' });

    const { status, body } = await post({
      actionType: 'delete',
      paths: JSON.stringify(['tmp-fs-archive-probe/a.ts', 'tmp-fs-archive-probe/src']),
    });

    expect(status).toBe(200);
    expect(body.removed).toEqual(['tmp-fs-archive-probe/a.ts', 'tmp-fs-archive-probe/src']);
    expect(fs.existsSync(path.join(DIR, 'a.ts'))).toBe(false);
    expect(fs.existsSync(path.join(DIR, 'src'))).toBe(false);
    expect(fs.existsSync(path.join(DIR, 'keep.ts'))).toBe(true);
  });

  test('refuses a path outside the scoped root', async () => {
    reset({ 'a.ts': 'A' });
    const { status } = await post({ actionType: 'delete', paths: JSON.stringify(['../outside.ts']) });
    expect(status).toBe(403);
  });
});

describe('fs archive actions', () => {
  test.skipIf(!hasZip)('compress then extract round-trips the selection', async () => {
    reset({ 'a.ts': 'A', 'deep/b.ts': 'B' });

    const compressed = await post({
      actionType: 'compress',
      format: 'zip',
      name: 'bundle.zip',
      destination: 'tmp-fs-archive-probe',
      paths: JSON.stringify(['tmp-fs-archive-probe/a.ts', 'tmp-fs-archive-probe/deep']),
    });

    expect(compressed.status).toBe(200);
    expect(compressed.body.path).toBe('tmp-fs-archive-probe/bundle.zip');
    expect(fs.existsSync(path.join(DIR, 'bundle.zip'))).toBe(true);

    const extracted = await post({
      actionType: 'extract',
      path: 'tmp-fs-archive-probe/bundle.zip',
      destination: 'tmp-fs-archive-probe/out',
    });

    expect(extracted.status).toBe(200);
    expect(fs.readFileSync(path.join(DIR, 'out/a.ts'), 'utf8')).toBe('A');
    expect(fs.readFileSync(path.join(DIR, 'out/deep/b.ts'), 'utf8')).toBe('B');
  });

  test('refuses an archive name carrying a path separator', async () => {
    reset({ 'a.ts': 'A' });
    const { status } = await post({
      actionType: 'compress',
      format: 'zip',
      name: '../escape.zip',
      destination: 'tmp-fs-archive-probe',
      paths: JSON.stringify(['tmp-fs-archive-probe/a.ts']),
    });
    expect(status).toBe(400);
  });

  test('refuses to extract a file that is not an archive', async () => {
    reset({ 'notes.txt': 'hello' });
    const { status, body } = await post({
      actionType: 'extract',
      path: 'tmp-fs-archive-probe/notes.txt',
      destination: 'tmp-fs-archive-probe/out',
    });
    expect(status).toBe(400);
    expect(String(body.error)).toContain('recognised archive');
  });

  test('refuses a destination outside the scoped root', async () => {
    reset({ 'a.ts': 'A' });
    const { status } = await post({
      actionType: 'compress',
      format: 'zip',
      name: 'bundle.zip',
      destination: '../outside',
      paths: JSON.stringify(['tmp-fs-archive-probe/a.ts']),
    });
    expect(status).toBe(403);
  });
});
