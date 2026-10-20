/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What the Files panel lists.
 *
 * The panel used to drop a hardcoded set of names (`node_modules`, `.git`,
 * `dist`, `build`) at every depth, which hid `packages/android/dist` — the
 * built APKs — from the user with no way to reach it. There is now no name
 * filter at all: every entry is listed, and the `ignored` flag (one
 * `git check-ignore` per listing) is what marks the untracked ones for dimming.
 *
 * Driven against a real temp directory, because the listing stats every entry
 * and asks git about it.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listDirectoryEntries } from '@/server/lib/fs/listing';

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) fs.rmSync(roots.pop() as string, { recursive: true, force: true });
});

function makeRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kabmo-listing-'));
  roots.push(dir);
  return dir;
}

function mkdirs(root: string, names: string[]): void {
  for (const name of names) fs.mkdirSync(path.join(root, name), { recursive: true });
}

describe('listDirectoryEntries', () => {
  test('lists every entry, node_modules and .git included', async () => {
    const root = makeRoot();
    mkdirs(root, ['src', 'dist', 'build', 'node_modules/preact', '.git/objects']);

    const names = (await listDirectoryEntries(root, root)).map((entry) => entry.name);

    expect(names).toContain('dist');
    expect(names).toContain('build');
    expect(names).toContain('src');
    // No name table: the panel must be able to reach anything on disk.
    expect(names).toContain('node_modules');
    expect(names).toContain('.git');
  });

  test('a nested dist is listed where it lives, not filtered by name', async () => {
    const root = makeRoot();
    mkdirs(root, ['packages/android/dist', 'packages/core']);

    const packages = await listDirectoryEntries(path.join(root, 'packages'), root);
    expect(packages.map((entry) => entry.name)).toEqual(['android', 'core']);

    const android = await listDirectoryEntries(path.join(root, 'packages/android'), root);
    expect(android.map((entry) => entry.name)).toEqual(['dist']);
    // Paths stay relative to the LISTED root, which is what the tree keys on,
    // and they are POSIX-spelled whatever the platform: `path.relative` answers
    // `packages\android\dist` on Windows, which keyed every row differently from
    // the same row on POSIX and — because `git check-ignore` rejects a
    // backslash — left the whole listing un-dimmed there. This assertion is the
    // guard; it is what failed on the Windows CI leg.
    expect(android[0]!.path).toBe('packages/android/dist');
  });

  test('folders sort before files, and dot-entries are listed', async () => {
    const root = makeRoot();
    fs.mkdirSync(path.join(root, 'zebra'));
    fs.writeFileSync(path.join(root, 'alpha.txt'), '');
    fs.writeFileSync(path.join(root, '.env'), 'K=1\n');

    const entries = await listDirectoryEntries(root, root);
    const names = entries.map((entry) => entry.name);

    expect(entries[0]!.type).toBe('folder');
    expect(names).toEqual(['zebra', '.env', 'alpha.txt']);
  });
});
