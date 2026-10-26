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
 * The other half is the COLLAPSE: a folder holding exactly one folder and
 * nothing else becomes one row naming the whole chain, which is what keeps a
 * Java package tree (`com/java/app/package`) from spending four rows to reach
 * the files inside it.
 *
 * Driven against a real temp directory, because the listing stats every entry,
 * walks every single-child chain and asks git about it.
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
    // No name table: the panel must be able to reach anything on disk. A
    // dependency folder is a single-child chain on its own, so it is listed by
    // the chain it collapses to — `node_modules/preact`, not `node_modules`.
    expect(names).toContain('node_modules/preact');
    expect(names).toContain('.git/objects');
  });

  test('a nested dist is listed where it lives, not filtered by name', async () => {
    const root = makeRoot();
    mkdirs(root, ['packages/android/dist', 'packages/core']);

    const packages = await listDirectoryEntries(path.join(root, 'packages'), root);
    // `android` holds nothing but `dist`, so the two collapse into one row —
    // and the path still names the deepest directory, which is the one whose
    // contents the row expands into.
    expect(packages.map((entry) => entry.name)).toEqual(['android/dist', 'core']);
    expect(packages[0]!.path).toBe('packages/android/dist');

    const dist = await listDirectoryEntries(path.join(root, 'packages/android/dist'), root);
    expect(dist).toEqual([]);
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

describe('single-child chains', () => {
  test('a package tree collapses into one row naming the whole chain', async () => {
    const root = makeRoot();
    fs.mkdirSync(path.join(root, 'com/java/app/package'), { recursive: true });
    fs.writeFileSync(path.join(root, 'com/java/app/package/Main.java'), 'class Main {}\n');

    const entries = await listDirectoryEntries(root, root);

    expect(entries).toHaveLength(1);
    expect(entries[0]!.name).toBe('com/java/app/package');
    expect(entries[0]!.path).toBe('com/java/app/package');
    expect(entries[0]!.id).toBe('com/java/app/package');
    expect(entries[0]!.type).toBe('folder');
    // The chain's own levels are never listed, so the panel reads one directory
    // to show the row and one more when it expands.
    const inner = await listDirectoryEntries(path.join(root, 'com/java/app/package'), root);
    expect(inner.map((entry) => entry.name)).toEqual(['Main.java']);
  });

  test('a chain stops at the first level that holds a file', async () => {
    const root = makeRoot();
    fs.mkdirSync(path.join(root, 'a/b/c'), { recursive: true });
    fs.writeFileSync(path.join(root, 'a/b/README.md'), 'x\n');

    const entries = await listDirectoryEntries(root, root);

    // `a` holds nothing but `b`, so the walk continues; `b` holds a folder AND a
    // file, so it is where the chain ends.
    expect(entries.map((entry) => entry.name)).toEqual(['a/b']);
    const insideB = await listDirectoryEntries(path.join(root, 'a/b'), root);
    expect(insideB.map((entry) => entry.name)).toEqual(['c', 'README.md']);
  });

  test('two folders never collapse, and neither does an empty one', async () => {
    const root = makeRoot();
    mkdirs(root, ['pair/one', 'pair/two', 'empty']);

    const entries = await listDirectoryEntries(root, root);

    expect(entries.map((entry) => entry.name)).toEqual(['empty', 'pair']);
    const pair = await listDirectoryEntries(path.join(root, 'pair'), root);
    expect(pair.map((entry) => entry.name)).toEqual(['one', 'two']);
  });

  test('a git-ignored chain is dimmed from its deepest directory', async () => {
    const root = makeRoot();
    fs.mkdirSync(path.join(root, 'a/b/c'), { recursive: true });
    fs.writeFileSync(path.join(root, 'a/b/c/f.txt'), 'x\n');
    fs.writeFileSync(path.join(root, '.gitignore'), 'a/\n');
    Bun.spawnSync({ cmd: ['git', 'init', '-q'], cwd: root });

    const entries = await listDirectoryEntries(root, root);

    const row = entries.find((entry) => entry.path === 'a/b/c');
    expect(row?.name).toBe('a/b/c');
    // A rule matching an OUTER level of the chain answers for the deepest one
    // too (verified against `git check-ignore`), which is the path the row names.
    expect(row?.ignored).toBe(true);
  });
});
