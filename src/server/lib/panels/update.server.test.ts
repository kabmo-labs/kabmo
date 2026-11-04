/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The dispatch the pane's Update buttons go through.
 *
 * `updatePanelPlugin` is the one entry point for both sources, so the cases that
 * matter are the ones a per-source button would have got wrong: a git clone is
 * fetched and reset AND its freshness is written (a stale status would leave the
 * card offering the update it just applied), while a directory with no source is
 * refused by name rather than silently succeeding.
 *
 * `updateAllPanelPlugins` probes before it fetches: only a clone that is actually
 * behind is moved, so an up-to-date one costs a ref lookup and nothing else.
 *
 * Driven against REAL git repositories, like `git-update.server.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { installPanelPluginFromGit } from '@/server/lib/panels/install.server';
import { installPanelPluginFromBundled } from '@/server/lib/panels/install.server';
import { updateAllPanelPlugins, updatePanelPlugin } from '@/server/lib/panels/update.server';
import { readGitStatus } from '@/server/lib/panels/git-status.server';
import { invalidatePanelScan } from '@/server/lib/panels/registry.server';
import { removeDir } from '@/test-support/remove-dir';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';

const hasGit = Boolean(Bun.which('git'));

/** Real git processes plus a plugin build; see the note in the sibling suite. */
setDefaultTimeout(30_000);

let work = '';
let root = '';
let store = '';

const VALID = { id: 'from-git', name: 'From Git', version: '1.0.0', app: 'dist/app.js' };

function git(dir: string, args: string[]): void {
  Bun.spawnSync(['git', '-C', dir, ...args], { stdout: 'pipe', stderr: 'pipe' });
}

function makeRepo(): string {
  const dir = fs.mkdtempSync(join(work, 'repo-'));
  fs.writeFileSync(join(dir, 'kabmo.json'), JSON.stringify(VALID));
  fs.mkdirSync(join(dir, 'dist'), { recursive: true });
  fs.writeFileSync(join(dir, 'dist', 'app.js'), 'export default {};');
  git(dir, ['init', '-q']);
  git(dir, ['config', 'core.autocrlf', 'false']);
  git(dir, ['config', 'core.eol', 'lf']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'init']);
  return dir;
}

function advance(repo: string, version: string): void {
  fs.writeFileSync(join(repo, 'kabmo.json'), JSON.stringify({ ...VALID, version }));
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', `v${version}`]);
}

beforeEach(async () => {
  work = fs.mkdtempSync(join(tmpdir(), 'omp-panels-update-repos-'));
  root = fs.mkdtempSync(join(tmpdir(), 'omp-panels-update-work-'));
  store = fs.mkdtempSync(join(tmpdir(), 'omp-panels-update-store-'));
  process.env.KABMO_MARKETPLACE_DIR = root;
  process.env.KABMO_BUNDLED_MARKETPLACE_DIR = store;
  // The baselines and the refusal records live in `app_settings`, so a suite
  // without this reads — and writes — the developer's own database, and the
  // edit gate then answers from another install's history.
  await isolateDb();
  globalThis.__kabmoPanelGitStatus?.clear();
  invalidatePanelScan();
});

afterEach(async () => {
  delete process.env.KABMO_MARKETPLACE_DIR;
  delete process.env.KABMO_BUNDLED_MARKETPLACE_DIR;
  // The freshness cache is a `globalThis` map, so a status this suite wrote
  // would outlive it and answer for a plugin another suite never probed.
  globalThis.__kabmoPanelGitStatus?.clear();
  await releaseDb();
  invalidatePanelScan();
  for (const dir of [work, root, store]) removeDir(dir);
});

function installedVersion(pluginId: string): string {
  const manifest = JSON.parse(fs.readFileSync(join(root, 'plugins', pluginId, 'kabmo.json'), 'utf8')) as {
    version: string;
  };
  return manifest.version;
}

describe('updatePanelPlugin on a git clone', () => {
  test.skipIf(!hasGit)('moves the files and writes the freshness it just achieved', async () => {
    const repo = makeRepo();
    await installPanelPluginFromGit(repo);
    advance(repo, '2.0.0');

    const result = await updatePanelPlugin('from-git');
    expect(result.updated).toBe(true);
    expect(result.error).toBeUndefined();
    expect(installedVersion('from-git')).toBe('2.0.0');

    // The status must say CURRENT after the update: leaving the previous
    // "behind" verdict would keep offering an update that already happened.
    expect(readGitStatus('from-git')?.updateAvailable).toBe(false);
  });

  test.skipIf(!hasGit)('reports a dirty clone by name and touches nothing', async () => {
    const repo = makeRepo();
    await installPanelPluginFromGit(repo);
    advance(repo, '2.0.0');
    fs.writeFileSync(join(root, 'plugins', 'from-git', 'dist', 'app.js'), 'export default { edited: true };');

    const result = await updatePanelPlugin('from-git');
    expect(result.updated).toBe(false);
    expect(result.error).toContain('uncommitted changes');
    expect(installedVersion('from-git')).toBe('1.0.0');
  });
});

describe('updatePanelPlugin on a directory nothing publishes', () => {
  test('refuses it by naming why', async () => {
    const dir = join(root, 'plugins', 'plain');
    fs.mkdirSync(join(dir, 'dist'), { recursive: true });
    fs.writeFileSync(join(dir, 'kabmo.json'), JSON.stringify({ ...VALID, id: 'plain' }));
    fs.writeFileSync(join(dir, 'dist', 'app.js'), 'export default {};');

    const result = await updatePanelPlugin('plain');
    expect(result.updated).toBe(false);
    expect(result.error).toContain('local directory');
  });

  test('refuses an id that is not installed at all', async () => {
    expect((await updatePanelPlugin('ghost')).error).toContain('No installed plugin');
  });
});

describe('updateAllPanelPlugins', () => {
  test.skipIf(!hasGit)('updates a clone that is behind and leaves a current one alone', async () => {
    const behind = makeRepo();
    await installPanelPluginFromGit(behind);
    advance(behind, '2.0.0');

    // A second plugin whose remote never moved.
    const current = fs.mkdtempSync(join(work, 'repo-'));
    fs.writeFileSync(join(current, 'kabmo.json'), JSON.stringify({ ...VALID, id: 'current', name: 'Current' }));
    fs.mkdirSync(join(current, 'dist'), { recursive: true });
    fs.writeFileSync(join(current, 'dist', 'app.js'), 'export default {};');
    git(current, ['init', '-q']);
    git(current, ['config', 'core.autocrlf', 'false']);
    git(current, ['config', 'user.email', 'test@example.com']);
    git(current, ['config', 'user.name', 'Test']);
    git(current, ['add', '-A']);
    git(current, ['commit', '-q', '-m', 'init']);
    await installPanelPluginFromGit(current);

    invalidatePanelScan();
    const outcome = await updateAllPanelPlugins();

    expect(outcome.updated).toEqual(['from-git']);
    expect(installedVersion('from-git')).toBe('2.0.0');
    // The current clone was probed, found equal, and not fetched or reset.
    expect(outcome.refused).toEqual([]);
    expect(readGitStatus('current')?.updateAvailable).toBe(false);
  });

  test('applies a store update for a bundled install', async () => {
    // The store path of the same pass: installed 1.0.0, store ships 1.1.0.
    const bundled = { ...VALID, id: 'demo', name: 'Demo' };
    for (const dir of [join(root, 'plugins', 'demo'), join(store, 'plugins', 'demo')]) {
      fs.mkdirSync(join(dir, 'dist'), { recursive: true });
      fs.writeFileSync(join(dir, 'kabmo.json'), JSON.stringify(bundled));
      fs.writeFileSync(join(dir, 'dist', 'app.js'), 'export default {};');
    }
    await installPanelPluginFromBundled('demo');
    fs.writeFileSync(join(store, 'plugins', 'demo', 'kabmo.json'), JSON.stringify({ ...bundled, version: '1.1.0' }));
    invalidatePanelScan();

    const outcome = await updateAllPanelPlugins();
    expect(outcome.updated).toContain('demo');
    expect(installedVersion('demo')).toBe('1.1.0');
  });
});
