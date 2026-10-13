/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The Files panel's transfer actions at the route: `duplicate` and `paste`.
 *
 * The refusals are the point, and each one is a rule a client could otherwise
 * skip: a paste that names a source outside the scoped root, a folder pasted
 * into its own subtree, and a paste whose clipboard entry was deleted between
 * the copy and the paste. The overwrite rule belongs to `transfer.ts` and is
 * asserted there; this file asserts that the ROUTE reaches it — a transfer that
 * resolved to the wrong paths would still "succeed" while writing somewhere the
 * user never named.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { action } from '@/server/routes/fs/action';

/** Probes live in the repo root — the one directory the root allow-list always accepts. */
const DIR = path.join(process.cwd(), 'tmp-fs-transfer-probe');

/** Write each `dir-relative` file under the repo root, keyed by its full relative path. */
function reset(files: Record<string, string>): void {
  fs.rmSync(DIR, { recursive: true, force: true });
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(process.cwd(), rel);
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
  return { status: res.status, body: (await res.json()) as { success?: boolean; path?: string; error?: string } };
}

describe('fs duplicate', () => {
  test('copies a file beside itself and reports the name it chose', async () => {
    reset({ 'tmp-fs-transfer-probe/a.ts': 'A', 'tmp-fs-transfer-probe/a copy.ts': 'C1' });

    const { status, body } = await post({ actionType: 'duplicate', path: 'tmp-fs-transfer-probe/a.ts' });

    expect(status).toBe(200);
    expect(body).toEqual({ success: true, path: 'tmp-fs-transfer-probe/a copy 2.ts' });
    expect(fs.readFileSync(path.join(DIR, 'a copy 2.ts'), 'utf8')).toBe('A');
  });

  test('copies a folder tree', async () => {
    reset({ 'tmp-fs-transfer-probe/src/a.ts': 'A' });

    const { body } = await post({ actionType: 'duplicate', path: 'tmp-fs-transfer-probe/src' });

    expect(body.path).toBe('tmp-fs-transfer-probe/src copy');
    expect(fs.readFileSync(path.join(DIR, 'src copy/a.ts'), 'utf8')).toBe('A');
  });
});

describe('fs paste', () => {
  test('a cut moves the entry into the named folder', async () => {
    reset({ 'tmp-fs-transfer-probe/a.ts': 'A', 'tmp-fs-transfer-probe/dest/.keep': '' });

    const { status, body } = await post({
      actionType: 'paste',
      sourcePath: 'tmp-fs-transfer-probe/a.ts',
      mode: 'cut',
      targetPath: 'tmp-fs-transfer-probe/dest',
      targetKind: 'folder',
    });

    expect(status).toBe(200);
    expect(body).toEqual({ success: true, path: 'tmp-fs-transfer-probe/dest/a.ts' });
    expect(fs.existsSync(path.join(DIR, 'a.ts'))).toBe(false);
    expect(fs.readFileSync(path.join(DIR, 'dest/a.ts'), 'utf8')).toBe('A');
  });

  test('a paste onto a FILE lands in that file’s own directory', async () => {
    reset({ 'tmp-fs-transfer-probe/a.ts': 'A', 'tmp-fs-transfer-probe/dest/b.ts': 'B' });

    const { body } = await post({
      actionType: 'paste',
      sourcePath: 'tmp-fs-transfer-probe/a.ts',
      mode: 'copy',
      targetPath: 'tmp-fs-transfer-probe/dest/b.ts',
      targetKind: 'file',
    });

    expect(body).toEqual({ success: true, path: 'tmp-fs-transfer-probe/dest/a.ts' });
  });

  test('a paste onto the listing root background lands at the top of the tree', async () => {
    reset({ 'tmp-fs-transfer-probe/dest/a.ts': 'A' });

    const { body } = await post({
      actionType: 'paste',
      sourcePath: 'tmp-fs-transfer-probe/dest/a.ts',
      mode: 'cut',
      targetPath: 'tmp-fs-transfer-probe',
      targetKind: 'folder',
    });

    expect(body).toEqual({ success: true, path: 'tmp-fs-transfer-probe/a.ts' });
    expect(fs.readFileSync(path.join(DIR, 'a.ts'), 'utf8')).toBe('A');
  });

  test('refuses a folder pasted into its own subtree', async () => {
    reset({ 'tmp-fs-transfer-probe/src/a.ts': 'A', 'tmp-fs-transfer-probe/src/deep/.keep': '' });

    const { status, body } = await post({
      actionType: 'paste',
      sourcePath: 'tmp-fs-transfer-probe/src',
      mode: 'copy',
      targetPath: 'tmp-fs-transfer-probe/src/deep',
      targetKind: 'folder',
    });

    expect(status).toBe(409);
    expect(body.error).toContain('itself');
  });

  test('refuses a source outside the scoped root', async () => {
    reset({ 'tmp-fs-transfer-probe/a.ts': 'A' });

    const { status } = await post({
      actionType: 'paste',
      sourcePath: '../outside.ts',
      mode: 'copy',
      targetPath: 'tmp-fs-transfer-probe',
      targetKind: 'folder',
    });

    expect(status).toBe(403);
  });

  test('reports a clipboard entry that no longer exists instead of pasting nothing', async () => {
    reset({ 'tmp-fs-transfer-probe/dest/.keep': '' });

    const { status, body } = await post({
      actionType: 'paste',
      sourcePath: 'tmp-fs-transfer-probe/gone.ts',
      mode: 'copy',
      targetPath: 'tmp-fs-transfer-probe/dest',
      targetKind: 'folder',
    });

    expect(status).toBe(404);
    expect(body.error).toContain('no longer exists');
  });
});
