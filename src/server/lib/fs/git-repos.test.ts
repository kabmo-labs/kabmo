/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Repository discovery, and the ORDER it returns.
 *
 * The order is not cosmetic. Two consumers pick a DEFAULT out of this list when
 * the session has no repository chosen — the git route's implicit repo
 * (`repo = repos.includes('.') ? '.' : repos[0]`) and the panel's
 * `resolveRepoForPanel` — so an unordered list makes "which repository am I
 * looking at" depend on the filesystem.
 *
 * Measured: `readdir` returned `['conflicted', 'alpha']` for a directory whose
 * entries were created in the other order, and the repository-modal browser spec
 * selected `alpha` on one machine and `conflicted` on another, then failed to
 * find the row it expected (`Show alpha` reads `Already showing this repository`
 * once `alpha` IS the pick). The spec had passed locally and failed in CI on the
 * same commit, which is exactly the shape a non-deterministic list produces.
 *
 * The walk is driven against real directories, because the order under test is
 * the filesystem's.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discoveredRepos, startRepoScan } from '@/server/lib/fs/git-repos';

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) fs.rmSync(roots.pop() as string, { recursive: true, force: true });
});

/** A directory holding one `.git` per named child, plus an optional root repo. */
function makeRoot(names: string[], options: { rootIsRepo?: boolean } = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ompchamber-repos-'));
  roots.push(dir);
  if (options.rootIsRepo) fs.mkdirSync(path.join(dir, '.git'));
  for (const name of names) fs.mkdirSync(path.join(dir, name, '.git'), { recursive: true });
  return dir;
}

/** Run a scan to completion and read its answer. */
async function scan(dir: string): Promise<string[]> {
  startRepoScan(dir);
  // The walk is async; poll until it reports done rather than sleeping.
  for (let i = 0; i < 200; i += 1) {
    const { repos, pending } = discoveredRepos(dir);
    if (!pending) return repos;
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 5);
    await promise;
  }
  throw new Error('the repository scan never finished');
}

describe('repository discovery order', () => {
  test('is sorted, whatever order the filesystem hands the entries back', async () => {
    // Created in REVERSE alphabetical order on purpose: the whole point is that
    // the answer does not depend on how the directory came to exist.
    const dir = makeRoot(['zulu', 'mike', 'alpha']);

    expect(await scan(dir)).toEqual(['alpha', 'mike', 'zulu']);
  });

  test('the same root scans to the same list twice', async () => {
    const dir = makeRoot(['beta', 'alpha']);

    const first = await scan(dir);
    const second = await scan(dir);

    // A list that reorders itself between two reads is the failure this pins.
    expect(second).toEqual(first);
  });

  test('a root that is itself a repo leads, and the rest stay sorted', async () => {
    // `.` first is the convention every consumer already assumes (it is the
    // repo the panels default to when the workspace root is one).
    const dir = makeRoot(['zulu', 'alpha'], { rootIsRepo: true });

    expect(await scan(dir)).toEqual(['.', 'alpha', 'zulu']);
  });

  test('a root with no repository at all answers the root alone', async () => {
    const dir = makeRoot([]);

    expect(await scan(dir)).toEqual(['.']);
  });

  test('a nested repo is reported by its relative path, sorted by that path', async () => {
    const dir = makeRoot([]);
    fs.mkdirSync(path.join(dir, 'projects', 'b', '.git'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'projects', 'a', '.git'), { recursive: true });

    expect(await scan(dir)).toEqual(['projects/a', 'projects/b']);
  });
});
