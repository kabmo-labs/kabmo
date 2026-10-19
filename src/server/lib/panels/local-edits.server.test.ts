/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The file-hash baseline the bundled sync compares against.
 *
 * What makes this feature work or fail is the EXCLUSION list, and it fails in the
 * direction that is hardest to notice: tracking a file the install's own build
 * writes (`dist/`, `bun.lock`, `node_modules`) makes every plugin read as edited
 * the first time it builds, and the sync then silently never runs again. The
 * opposite mistake — missing a file the user actually edited — is the one the
 * baseline exists to catch.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { changedPaths, hashTrackedFiles } from '@/server/lib/panels/local-edits.server';

let dir = '';

/** Write a file, creating its parent directories. */
function write(relative: string, content: string): void {
  const target = join(dir, relative);
  fs.mkdirSync(join(target, '..'), { recursive: true });
  fs.writeFileSync(target, content);
}

beforeEach(() => {
  dir = fs.mkdtempSync(join(tmpdir(), 'omp-baseline-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('hashTrackedFiles', () => {
  test('hashes nested files under POSIX-style relative paths', async () => {
    write('kabmo.json', '{}');
    write('src/deep/app.tsx', 'export default {};');

    const hashes = await hashTrackedFiles(dir);
    expect(Object.keys(hashes).sort()).toEqual(['kabmo.json', 'src/deep/app.tsx']);
    // A path separator in a key would make the same file hash under two names
    // depending on the platform, and the comparison is by key.
    expect(hashes['src/deep/app.tsx']).not.toContain('\\');
  });

  test('excludes node_modules, lockfiles and .git unconditionally', async () => {
    write('kabmo.json', '{}');
    write('node_modules/dep/package.json', '{}');
    write('bun.lock', '{}');
    write('.git/config', '[core]');

    // Tracking any of these marks every plugin as edited the first time it
    // builds, and the sync then never runs again.
    expect(Object.keys(await hashTrackedFiles(dir))).toEqual(['kabmo.json']);
  });

  test('excludes dist for a plugin that BUILDS from source', async () => {
    write('kabmo.json', '{}');
    write('src/app.tsx', 'export default {};');
    write('dist/app.js', 'built');

    // `dist` is this build's output here, so its hashes change on every build.
    expect(Object.keys(await hashTrackedFiles(dir)).sort()).toEqual(['kabmo.json', 'src/app.tsx']);
  });

  test('TRACKS dist for a plugin with no source, because it distributes its bundle', async () => {
    write('kabmo.json', '{}');
    write('dist/app.js', 'export default {};');

    // No `src/` and no build script: `dist` is content the user can edit, and
    // excluding it would let the sync overwrite the edit silently.
    expect(Object.keys(await hashTrackedFiles(dir)).sort()).toEqual(['dist/app.js', 'kabmo.json']);
  });

  test('a build script alone is enough to treat dist as output', async () => {
    write('package.json', JSON.stringify({ scripts: { build: 'bun build src/entry.ts --outfile dist/app.js' } }));
    write('src/entry.ts', 'export default {};');
    write('dist/app.js', 'built');

    expect(Object.keys(await hashTrackedFiles(dir)).sort()).toEqual(['package.json', 'src/entry.ts']);
  });

  test('a missing directory is empty, not a throw', async () => {
    expect(await hashTrackedFiles(join(dir, 'nope'))).toEqual({});
  });

  test('a changed byte changes the hash', async () => {
    write('note.txt', 'one');
    const before = await hashTrackedFiles(dir);
    write('note.txt', 'two');
    expect((await hashTrackedFiles(dir))['note.txt']).not.toBe(before['note.txt']);
  });
});

describe('changedPaths', () => {
  const baseline = { 'a.ts': 'h1', 'b.ts': 'h2' };

  test('an identical tree reports nothing', () => {
    expect(changedPaths(baseline, { 'a.ts': 'h1', 'b.ts': 'h2' })).toEqual([]);
  });

  test('a modified, an added and a removed file are all reported', () => {
    const current = { 'a.ts': 'CHANGED', 'c.ts': 'new' };
    // `b.ts` is absent from current, so it was REMOVED — reported too.
    expect(changedPaths(baseline, current)).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });

  test('the list is sorted, so a report is stable across runs', () => {
    const current = { 'a.ts': 'h1', 'b.ts': 'h2', 'z.ts': 'new' };
    expect(changedPaths(baseline, current)).toEqual(['z.ts']);
    const two = { 'a.ts': 'CHANGED', 'b.ts': 'h2', 'z.ts': 'new' };
    expect(changedPaths(baseline, two)).toEqual(['a.ts', 'z.ts']);
  });

  test('an empty baseline makes every current file an addition', () => {
    // A recorded-but-empty baseline means the install wrote nothing, so anything
    // present now was put there by someone else.
    expect(changedPaths({}, { 'x.ts': 'h' })).toEqual(['x.ts']);
  });
});
