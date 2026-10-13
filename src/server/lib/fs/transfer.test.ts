/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `pasteEntry` / `duplicateEntry` — the transfer rules the panel's Cut, Copy,
 * Paste and Duplicate all end at.
 *
 * The first rule is the one that destroys data if it is wrong: **a paste never
 * overwrites**. `cp` and `rename` both clobber silently, so every case here
 * asserts the file that was already there is still there afterwards, under its
 * own bytes. The second is `EXDEV`: `rename` is atomic but only within one
 * filesystem, and a workspace on another volume must still move.
 *
 * Real directories under the repo root, because the thing under test is what
 * the filesystem did.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { duplicateEntry, moveEntry, nextDuplicateName, pasteEntry, toRelPath } from '@/server/lib/fs/transfer';

const DIR = path.join(process.cwd(), 'tmp-transfer-probe');

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

const abs = (rel: string) => path.join(DIR, rel);

describe('pasteEntry', () => {
  test('copies a file beside its destination without touching the source', async () => {
    reset({ 'a.ts': 'A', 'dest/keep.ts': 'K' });

    const outcome = await pasteEntry({ scopedRoot: DIR, sourcePath: abs('a.ts'), destinationDir: abs('dest'), mode: 'copy' });

    expect(outcome).toEqual({ path: 'dest/a.ts' });
    expect(fs.readFileSync(abs('a.ts'), 'utf8')).toBe('A');
    expect(fs.readFileSync(abs('dest/a.ts'), 'utf8')).toBe('A');
  });

  test('a copy never overwrites — it lands under a copy name instead', async () => {
    reset({ 'a.ts': 'A', 'dest/a.ts': 'IMPORTANT' });

    const outcome = await pasteEntry({ scopedRoot: DIR, sourcePath: abs('a.ts'), destinationDir: abs('dest'), mode: 'copy' });

    expect(outcome).toEqual({ path: 'dest/a copy.ts' });
    expect(fs.readFileSync(abs('dest/a.ts'), 'utf8')).toBe('IMPORTANT');
    expect(fs.readFileSync(abs('dest/a copy.ts'), 'utf8')).toBe('A');
  });

  test('a cut MOVES the entry and removes the source', async () => {
    reset({ 'a.ts': 'A', 'dest/keep.ts': 'K' });

    const outcome = await pasteEntry({ scopedRoot: DIR, sourcePath: abs('a.ts'), destinationDir: abs('dest'), mode: 'cut' });

    expect(outcome).toEqual({ path: 'dest/a.ts' });
    expect(fs.existsSync(abs('a.ts'))).toBe(false);
    expect(fs.readFileSync(abs('dest/a.ts'), 'utf8')).toBe('A');
  });

  test('a cut pasted back into its own folder is refused, not renamed to a copy', async () => {
    reset({ 'dest/a.ts': 'A' });

    const outcome = await pasteEntry({ scopedRoot: DIR, sourcePath: abs('dest/a.ts'), destinationDir: abs('dest'), mode: 'cut' });

    expect(outcome.status).toBe(409);
    expect(outcome.error).toContain('already in this folder');
    expect(fs.readFileSync(abs('dest/a.ts'), 'utf8')).toBe('A');
  });

  test('a cut onto an existing name lands beside it and keeps both', async () => {
    reset({ 'a.ts': 'A', 'dest/a.ts': 'IMPORTANT' });

    const outcome = await pasteEntry({ scopedRoot: DIR, sourcePath: abs('a.ts'), destinationDir: abs('dest'), mode: 'cut' });

    expect(outcome).toEqual({ path: 'dest/a copy.ts' });
    expect(fs.existsSync(abs('a.ts'))).toBe(false);
    expect(fs.readFileSync(abs('dest/a.ts'), 'utf8')).toBe('IMPORTANT');
    expect(fs.readFileSync(abs('dest/a copy.ts'), 'utf8')).toBe('A');
  });

  test('copies a whole folder tree', async () => {
    reset({ 'src/a.ts': 'A', 'src/deep/b.ts': 'B', 'dest/keep.ts': 'K' });

    const outcome = await pasteEntry({ scopedRoot: DIR, sourcePath: abs('src'), destinationDir: abs('dest'), mode: 'copy' });

    expect(outcome).toEqual({ path: 'dest/src' });
    expect(fs.readFileSync(abs('dest/src/a.ts'), 'utf8')).toBe('A');
    expect(fs.readFileSync(abs('dest/src/deep/b.ts'), 'utf8')).toBe('B');
  });

  test('refuses a folder pasted into its own subtree, by the resolved path', async () => {
    reset({ 'src/a.ts': 'A' });

    const outcome = await pasteEntry({ scopedRoot: DIR, sourcePath: abs('src'), destinationDir: abs('src/deep'), mode: 'copy' });

    expect(outcome.status).toBe(409);
    expect(fs.existsSync(abs('src/deep'))).toBe(false);
  });

  test('refuses a destination that is a SYMLINK back into the source', async () => {
    // The containment check `resolveWithinRoot` cannot make: the destination
    // path is inside the root and outside the source, but the DIRECTORY it
    // resolves to is the source itself — a copy would recurse forever.
    reset({ 'src/a.ts': 'A' });
    fs.symlinkSync(abs('src'), abs('link'), 'dir');

    const outcome = await pasteEntry({ scopedRoot: DIR, sourcePath: abs('src'), destinationDir: abs('link'), mode: 'copy' });

    expect(outcome.status).toBe(409);
    expect(outcome.error).toContain('itself');
  });
});

describe('duplicateEntry', () => {
  test('copies the entry beside itself under the given name', async () => {
    reset({ 'a.ts': 'A' });

    const outcome = await duplicateEntry({ scopedRoot: DIR, sourcePath: abs('a.ts'), destinationName: 'a copy.ts' });

    expect(outcome).toEqual({ path: 'a copy.ts' });
    expect(fs.readFileSync(abs('a.ts'), 'utf8')).toBe('A');
    expect(fs.readFileSync(abs('a copy.ts'), 'utf8')).toBe('A');
  });

  test('nextDuplicateName walks past the copies already on disk', async () => {
    reset({ 'a.ts': 'A', 'a copy.ts': 'C1', 'a copy 2.ts': 'C2' });
    expect(await nextDuplicateName(abs('a.ts'), 'file')).toBe('a copy 3.ts');
  });

  test('nextDuplicateName names a folder `src copy`', async () => {
    reset({ 'src/a.ts': 'A' });
    expect(await nextDuplicateName(abs('src'), 'folder')).toBe('src copy');
  });
});

describe('moveEntry', () => {
  test('a rename that cannot cross filesystems falls back to copy-then-remove', async () => {
    reset({ 'a.ts': 'A' });
    const destination = abs('b.ts');
    // The real cross-device answer. Without the fallback this throws and the
    // panel reports an errno it cannot explain.
    const rename = fs.promises.rename;
    let calls = 0;
    fs.promises.rename = (async (from: string, to: string) => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error('EXDEV: cross-device link not permitted'), { code: 'EXDEV' });
      return rename(from, to);
    }) as typeof fs.promises.rename;
    try {
      await moveEntry(abs('a.ts'), destination);
    } finally {
      fs.promises.rename = rename;
    }

    expect(fs.existsSync(abs('a.ts'))).toBe(false);
    expect(fs.readFileSync(destination, 'utf8')).toBe('A');
  });

  test('a real failure is not swallowed — a missing source still reports', async () => {
    reset({});
    await expect(moveEntry(abs('nope.ts'), abs('b.ts'))).rejects.toThrow(/ENOENT/);
  });
});

describe('toRelPath', () => {
  test('emits the POSIX spelling the tree renders by', () => {
    expect(toRelPath(DIR, path.join(DIR, 'src', 'a.ts'))).toBe('src/a.ts');
  });
});
