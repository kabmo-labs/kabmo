/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The git-plugin freshness probe and updater, against REAL repositories.
 *
 * Every failure mode this module has lives in the interaction between `git`, a
 * shallow clone and a remote that moved — an unrelated-histories merge, a dirty
 * tree, a remote that is gone — so a stubbed `git` would exercise none of them.
 * The fixtures are local repositories, which makes the suite offline and
 * deterministic.
 *
 * `Bun.which('git')` guards it: the chamber treats a missing git as an
 * environment condition, not a bug, so the suite is skipped rather than failed.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { installPanelPluginFromGit } from '@/server/lib/panels/install.server';
import { probeGitUpdate, updateGitPlugin } from '@/server/lib/panels/git-update.server';
import { readGitOrigin } from '@/server/lib/panels/git-clone.server';
import { discoverPanelPlugins, invalidatePanelScan } from '@/server/lib/panels/registry.server';

const hasGit = Boolean(Bun.which('git'));

let root = '';
let work = '';

const VALID = { id: 'from-git', name: 'From Git', version: '1.0.0', app: 'dist/app.js' };

/** Run git in `dir`, ignoring failures the fixture does not care about. */
function git(dir: string, args: string[]): void {
  Bun.spawnSync(['git', '-C', dir, ...args], { stdout: 'pipe', stderr: 'pipe' });
}

/** A committed plugin repository, returned as a cloneable URL. */
function makeRepo(manifest: unknown = VALID): string {
  const dir = fs.mkdtempSync(join(work, 'repo-'));
  fs.writeFileSync(join(dir, 'ompchamber.json'), JSON.stringify(manifest));
  fs.mkdirSync(join(dir, 'dist'), { recursive: true });
  fs.writeFileSync(join(dir, 'dist', 'app.js'), 'export default {};');
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'init']);
  return dir;
}

/** Commit a new version of the plugin into `repo`, moving its HEAD. */
function advance(repo: string, version: string): void {
  fs.writeFileSync(join(repo, 'ompchamber.json'), JSON.stringify({ ...VALID, version }));
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', `v${version}`]);
}

beforeEach(() => {
  root = fs.mkdtempSync(join(tmpdir(), 'omp-panels-git-'));
  work = fs.mkdtempSync(join(tmpdir(), 'omp-panels-repos-'));
  process.env.OMPCHAMBER_MARKETPLACE_DIR = root;
  invalidatePanelScan();
});

afterEach(() => {
  delete process.env.OMPCHAMBER_MARKETPLACE_DIR;
  invalidatePanelScan();
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(work, { recursive: true, force: true });
});

describe('readGitOrigin', () => {
  test.skipIf(!hasGit)('reads the origin a clone was made from', async () => {
    const repo = makeRepo();
    await installPanelPluginFromGit(repo);
    expect(await readGitOrigin(join(root, 'plugins', 'from-git'))).toBe(repo);
  });

  test('a directory that is not a clone has no origin', async () => {
    const dir = join(root, 'plugins', 'plain');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(join(dir, 'ompchamber.json'), JSON.stringify(VALID));
    expect(await readGitOrigin(dir)).toBeNull();
  });

  test.skipIf(!hasGit)('a clone whose origin was removed has no origin', async () => {
    const repo = makeRepo();
    await installPanelPluginFromGit(repo);
    const dir = join(root, 'plugins', 'from-git');
    git(dir, ['remote', 'remove', 'origin']);
    expect(await readGitOrigin(dir)).toBeNull();
  });
});

describe('probeGitUpdate', () => {
  test.skipIf(!hasGit)('a clone at its remote head reports no update', async () => {
    const repo = makeRepo();
    await installPanelPluginFromGit(repo);

    const status = await probeGitUpdate('from-git');
    expect(status.error).toBeUndefined();
    expect(status.current).not.toBeNull();
    expect(status.current).toBe(status.latest);
    expect(status.updateAvailable).toBe(false);
  });

  test.skipIf(!hasGit)('a remote that moved one commit reports an update', async () => {
    const repo = makeRepo();
    await installPanelPluginFromGit(repo);
    advance(repo, '2.0.0');

    const status = await probeGitUpdate('from-git');
    expect(status.updateAvailable).toBe(true);
    expect(status.current).not.toBe(status.latest);
  });

  test.skipIf(!hasGit)('an unreachable remote is reported, not thrown', async () => {
    const repo = makeRepo();
    await installPanelPluginFromGit(repo);
    // Point the clone at a path that does not exist, which is what a deleted
    // repository or a dropped network looks like to git.
    git(join(root, 'plugins', 'from-git'), ['remote', 'set-url', 'origin', join(work, 'gone')]);

    const status = await probeGitUpdate('from-git');
    expect(status.error).toBeTruthy();
    expect(status.latest).toBeNull();
    expect(status.updateAvailable).toBe(false);
  });

  test('a plugin that is not a clone reports nothing to probe', async () => {
    const dir = join(root, 'plugins', 'plain');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(join(dir, 'ompchamber.json'), JSON.stringify(VALID));

    const status = await probeGitUpdate('plain');
    expect(status).toEqual({ current: null, latest: null, updateAvailable: false, checkedAt: null });
  });
});

describe('updateGitPlugin', () => {
  test.skipIf(!hasGit)('moves the clone to the remote commit and rebuilds nothing to change', async () => {
    const repo = makeRepo();
    await installPanelPluginFromGit(repo);
    advance(repo, '2.0.0');

    const result = await updateGitPlugin('from-git');
    expect(result.ok).toBe(true);
    expect(result.updated).toBe(true);

    // The FILES moved, not just the ref: the manifest on disk is the new one.
    const manifest = JSON.parse(fs.readFileSync(join(root, 'plugins', 'from-git', 'ompchamber.json'), 'utf8')) as {
      version: string;
    };
    expect(manifest.version).toBe('2.0.0');

    // And the probe now agrees there is nothing left to fetch.
    const status = await probeGitUpdate('from-git');
    expect(status.updateAvailable).toBe(false);
  });

  test.skipIf(!hasGit)('an already-current clone is a no-op', async () => {
    const repo = makeRepo();
    await installPanelPluginFromGit(repo);

    const result = await updateGitPlugin('from-git');
    expect(result.ok).toBe(true);
    expect(result.updated).toBe(false);
  });

  test.skipIf(!hasGit)('refuses a clone with uncommitted changes', async () => {
    const repo = makeRepo();
    await installPanelPluginFromGit(repo);
    advance(repo, '2.0.0');
    fs.writeFileSync(join(root, 'plugins', 'from-git', 'dist', 'app.js'), 'export default { edited: true };');

    const result = await updateGitPlugin('from-git');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('uncommitted changes');
    // The edit survives: refusing is the point.
    expect(fs.readFileSync(join(root, 'plugins', 'from-git', 'dist', 'app.js'), 'utf8')).toContain('edited');
  });

  test('refuses a plugin that is not a git clone', async () => {
    const dir = join(root, 'plugins', 'plain');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(join(dir, 'ompchamber.json'), JSON.stringify(VALID));

    const result = await updateGitPlugin('plain');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('not a git clone');
  });
});

describe('the scan reports a git origin', () => {
  test.skipIf(!hasGit)('an installed clone carries its origin, a plain copy carries null', async () => {
    const repo = makeRepo();
    await installPanelPluginFromGit(repo);
    const plain = join(root, 'plugins', 'plain');
    fs.mkdirSync(join(plain, 'dist'), { recursive: true });
    fs.writeFileSync(join(plain, 'ompchamber.json'), JSON.stringify({ ...VALID, id: 'plain', name: 'Plain' }));
    fs.writeFileSync(join(plain, 'dist', 'app.js'), 'export default {};');

    invalidatePanelScan();
    const { plugins } = await discoverPanelPlugins();
    const byId = new Map(plugins.map((plugin) => [plugin.pluginId, plugin]));
    expect(byId.get('from-git')?.gitOrigin).toBe(repo);
    expect(byId.get('plain')?.gitOrigin).toBeNull();
  });
});
