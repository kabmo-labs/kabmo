/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The reads that come back out of a wiki mirror: the tree, one page, one asset.
 *
 * Split from `git.test.ts` (which pins the spawn and the fetch classification)
 * because both files build real state and the pair crossed the 350-line ceiling
 * together. Nothing here reaches the fake `git` stub: the fixture is a REAL
 * bare repository, which is the only way to prove `git show <ref>:<path>`
 * answers the bytes the wiki holds.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { listWikiPaths, readWikiAsset, readWikiPage } from '@/server/lib/wiki/mirror.server';
import { cleanupFakeGit, fakeGitTempDir } from '@/test-support/fake-git';

/** Real-git helper for the local fixture repository. */
function git(cwd: string, args: string[]): void {
  const proc = Bun.spawnSync(['git', '-C', cwd, ...args], { stdout: 'pipe', stderr: 'pipe' });
  if (proc.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${proc.stderr.toString()}`);
}

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
let bareRepo = '';

afterAll(() => {
  cleanupFakeGit();
});

describe('mirror reads', () => {
  test('lists every path in the tree, keeping a space in the name', async () => {
    await buildFixture();

    expect((await listWikiPaths(bareRepo)).sort()).toEqual(['Home.md', 'Setting up notes.md', 'images/schema.png']);
  });

  test('reads a page at the ref and reports a missing one', async () => {
    await buildFixture();

    expect(await readWikiPage(bareRepo, 'Home.md')).toEqual({ ok: true, text: 'Home\n', truncated: false });
    expect(await readWikiPage(bareRepo, 'Nope.md')).toEqual({ ok: false, error: 'Page not found: Nope.md' });
  });

  test('reads an asset as bytes and refuses a missing one', async () => {
    await buildFixture();

    expect(await readWikiAsset(bareRepo, 'images/schema.png')).toEqual(PNG_BYTES);
    expect(await readWikiAsset(bareRepo, 'images/nope.png')).toBe(null);
  });
});

async function buildFixture(): Promise<void> {
  if (bareRepo) return;
  const work = join(fakeGitTempDir('omp-wiki-work-'), 'repo');
  mkdirSync(join(work, 'images'), { recursive: true });
  writeFileSync(join(work, 'Home.md'), 'Home\n');
  writeFileSync(join(work, 'Setting up notes.md'), 'notes\n');
  writeFileSync(join(work, 'images', 'schema.png'), PNG_BYTES);
  git(work, ['init', '-q']);
  // Byte-exact blobs: Git for Windows defaults `core.autocrlf` to true, which
  // rewrites a committed CRLF into LF — the fixture's PNG header (0d 0a) came
  // back as 0a and the asset read failed for a reason the code under test has
  // nothing to do with. A wiki mirror holds blobs authored elsewhere, so the
  // production read path is unaffected; the fixture must simply not normalise.
  git(work, ['config', 'core.autocrlf', 'false']);
  git(work, ['add', '-A']);
  git(work, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init']);
  bareRepo = join(fakeGitTempDir('omp-wiki-bare-'), 'bare.git');
  const clone = Bun.spawnSync(['git', 'clone', '-q', '--bare', work, bareRepo], { stdout: 'pipe', stderr: 'pipe' });
  if (clone.exitCode !== 0) throw new Error(clone.stderr.toString());
  git(bareRepo, ['update-ref', 'refs/wiki/latest', 'HEAD']);
}
