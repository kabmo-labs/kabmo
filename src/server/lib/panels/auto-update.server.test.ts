/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The background pass that keeps git-installed plugins current.
 *
 * Two rules decide whether this is safe to leave running unattended, and both
 * are failures that only appear in combination: the pass must do NOTHING while
 * the setting is off (it fetches a remote and hard-resets a clone), and it must
 * select ONLY plugins with a readable origin (a bundled install or a hand-copied
 * folder has no remote to fetch from, and guessing one would rewrite files the
 * user owns).
 *
 * Driven against real local repositories, because the selection rule is what the
 * pass exists for and a stub would not distinguish a clone from a copy.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runPanelAutoUpdatePass } from '@/server/lib/panels/auto-update.server';
import { installPanelPluginFromGit } from '@/server/lib/panels/install.server';
import { readGitStatus } from '@/server/lib/panels/git-status.server';
import { invalidatePanelScan } from '@/server/lib/panels/registry.server';

const hasGit = Boolean(Bun.which('git'));

let root = '';
let work = '';

const MANIFEST = { id: 'demo', name: 'Demo', version: '1.0.0', app: 'dist/app.js' };

function writePlugin(dir: string, manifest: unknown): void {
  fs.mkdirSync(join(dir, 'dist'), { recursive: true });
  fs.writeFileSync(join(dir, 'kabmo.json'), JSON.stringify(manifest));
  fs.writeFileSync(join(dir, 'dist', 'app.js'), 'export default {};');
}

/** A committed plugin repository, returned as a cloneable URL. */
function makeRepo(): string {
  const dir = fs.mkdtempSync(join(work, 'repo-'));
  writePlugin(dir, MANIFEST);
  const run = (args: string[]) => Bun.spawnSync(['git', '-C', dir, ...args], { stdout: 'pipe', stderr: 'pipe' });
  run(['init', '-q']);
  // Pin the line ending: a Windows host defaults `core.autocrlf` to true, which
  // rewrites every checked-out file to CRLF.
  run(['config', 'core.autocrlf', 'false']);
  run(['config', 'core.eol', 'lf']);
  run(['config', 'user.email', 'test@example.com']);
  run(['config', 'user.name', 'Test']);
  run(['add', '-A']);
  run(['commit', '-q', '-m', 'init']);
  return dir;
}

function advance(repo: string, version: string): void {
  writePlugin(repo, { ...MANIFEST, version });
  const run = (args: string[]) => Bun.spawnSync(['git', '-C', repo, ...args], { stdout: 'pipe', stderr: 'pipe' });
  run(['add', '-A']);
  run(['commit', '-q', '-m', `v${version}`]);
}

beforeEach(() => {
  root = fs.mkdtempSync(join(tmpdir(), 'omp-autoupd-'));
  work = fs.mkdtempSync(join(tmpdir(), 'omp-autoupd-repos-'));
  process.env.KABMO_MARKETPLACE_DIR = root;
  globalThis.__kabmoPanelGitStatus = undefined;
  invalidatePanelScan();
});

afterEach(() => {
  delete process.env.KABMO_MARKETPLACE_DIR;
  globalThis.__kabmoPanelGitStatus = undefined;
  invalidatePanelScan();
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(work, { recursive: true, force: true });
});

describe('runPanelAutoUpdatePass', () => {
  test.skipIf(!hasGit)('checks a clone and applies the remote commit', async () => {
    const repo = makeRepo();
    await installPanelPluginFromGit(repo);
    advance(repo, '2.0.0');

    const result = await runPanelAutoUpdatePass();
    expect(result.checked).toEqual(['demo']);
    expect(result.updated).toEqual(['demo']);
    expect(result.failed).toEqual([]);

    const manifest = JSON.parse(fs.readFileSync(join(root, 'plugins', 'demo', 'kabmo.json'), 'utf8')) as {
      version: string;
    };
    expect(manifest.version).toBe('2.0.0');
    // The pass records what it achieved, so the pane's badge agrees.
    expect(readGitStatus('demo')?.updateAvailable).toBe(false);
  });

  test.skipIf(!hasGit)('a clone already at its remote head is checked but not updated', async () => {
    const repo = makeRepo();
    await installPanelPluginFromGit(repo);

    const result = await runPanelAutoUpdatePass();
    expect(result.checked).toEqual(['demo']);
    expect(result.updated).toEqual([]);
  });

  test('a bundled install and a plain copy are never selected', async () => {
    writePlugin(join(root, 'plugins', 'bundled-copy'), MANIFEST);
    writePlugin(join(root, 'plugins', 'hand-copied'), { ...MANIFEST, id: 'hand-copied' });

    const result = await runPanelAutoUpdatePass();
    // No origin, nothing to fetch — the pass must not guess a remote for files
    // the user owns.
    expect(result.checked).toEqual([]);
    expect(result.updated).toEqual([]);
  });

  test.skipIf(!hasGit)('a clone whose update is refused is reported, not retried into failure', async () => {
    const repo = makeRepo();
    await installPanelPluginFromGit(repo);
    advance(repo, '2.0.0');
    // A local edit makes the update refuse — the same state a user's own change
    // puts the clone in.
    fs.writeFileSync(join(root, 'plugins', 'demo', 'dist', 'app.js'), 'export default { edited: true };');

    const result = await runPanelAutoUpdatePass();
    expect(result.checked).toEqual(['demo']);
    expect(result.updated).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].error).toContain('uncommitted changes');
    // The edit survives: refusing is the point.
    expect(fs.readFileSync(join(root, 'plugins', 'demo', 'dist', 'app.js'), 'utf8')).toContain('edited');
  });
});
