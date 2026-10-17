/**
 * The package release pipeline, asserted.
 *
 * The git plumbing is exercised against a THROWAWAY repository built in the
 * test, not against this one: the range a package is released from is a fact
 * about history, and a test that read this repo's tags would break the moment
 * a tag moved and would prove nothing about the code. A scratch repo also makes
 * the case that matters reproducible — a commit that touches no package must
 * produce no package release.
 */
import { expect, test, describe, beforeAll, afterAll } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { collectCommits, filesForCommits } from './commits.js';
import { RELEASE_PACKAGES, tagPrefix } from './packages.js';
import { packageReleaseConfig, scopeCommits } from './packages.mjs';
import { versionPackagePlugin } from './version-package.mjs';

// The exact Bun that is running these tests: on Windows `bun` on PATH can be a
// `.cmd` shim that libuv's `CreateProcess` cannot start, while `process.execPath`
// is the real `bun.exe` already executing.
const bunBin = process.execPath;

/**
 * `git` with the machine's own config out of the way: a global `core.hooksPath`
 * or `commit.gpgsign` would otherwise change what a commit records.
 */
function git(dir, ...args) {
  const result = spawnSync('git', ['-C', dir, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
  });

  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed:\n${result.stderr}`);
  }

  return result.stdout;
}

/** Write files and commit them, so a commit's paths are exactly what it touched. */
function commit(dir, message, files) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), content);
  }

  git(dir, 'add', '-A');
  git(dir, '-c', 'user.name=Test', '-c', 'user.email=1+tester@users.noreply.github.com', 'commit', '-q', '-m', message);
}

describe('package release pipeline', () => {
  /** @type {string} */
  let dir;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'ompchamber-release-'));
    git(dir, 'init', '-q', '--initial-branch=main');

    commit(dir, 'feat(a): first package change', { 'packages/a/src/index.ts': 'export const a = 1;\n' });
    git(dir, 'tag', 'a/v1.0.0');

    // The case the whole pipeline exists for: after the package's tag, a commit
    // that touches only the app. It must not reach the package's commit range.
    commit(dir, 'feat(app): a change the packages know nothing about', {
      'src/app.ts': 'export const app = 1;\n',
    });

    commit(dir, 'fix(a): a real package fix\n\nA body line.\n', { 'packages/a/src/index.ts': 'export const a = 2;\n' });

    commit(dir, 'chore(b): a sibling package change', { 'packages/b/src/index.ts': 'export const b = 1;\n' });
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('collects the commits in a range with their messages and authors', () => {
    const commits = collectCommits('a/v1.0.0..HEAD', dir);

    expect(commits.map((entry) => entry.message.split('\n')[0])).toEqual([
      'chore(b): a sibling package change',
      'fix(a): a real package fix',
      'feat(app): a change the packages know nothing about',
    ]);

    // A multi-line body survives: the notes generator parses it for the
    // BREAKING CHANGE footer, and a truncated body would drop that.
    expect(commits[1].message).toContain('A body line.');
    expect(commits[0].author.email).toBe('1+tester@users.noreply.github.com');
    expect(commits[0].committer.email).toBe(commits[0].author.email);
  });

  test('maps each commit to the paths it changed', () => {
    const commits = collectCommits('a/v1.0.0..HEAD', dir);
    const files = filesForCommits(commits.map((entry) => entry.hash), dir);
    const bySubject = new Map(commits.map((entry) => [entry.message.split('\n')[0], files.get(entry.hash)]));

    expect(bySubject.get('chore(b): a sibling package change')).toEqual(['packages/b/src/index.ts']);
    expect(bySubject.get('feat(app): a change the packages know nothing about')).toEqual(['src/app.ts']);
  });

  test('a path-less commit maps to an empty list, never to a missing entry', () => {
    // Its own repository: an empty commit added to the shared one would join
    // every later range in this file.
    const scratch = mkdtempSync(join(tmpdir(), 'ompchamber-release-empty-'));

    try {
      git(scratch, 'init', '-q', '--initial-branch=main');
      commit(scratch, 'feat(a): a first change', { 'packages/a/src/index.ts': 'export const a = 1;\n' });
      git(scratch, '-c', 'user.name=Test', '-c', 'user.email=1+tester@users.noreply.github.com', 'commit', '-q', '--allow-empty', '-m', 'chore: nothing at all');

      const [empty] = collectCommits('HEAD~1..HEAD', scratch);

      expect(filesForCommits([empty.hash], scratch).get(empty.hash)).toEqual([]);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  test('scoping keeps only the commits that touched the package', () => {
    const commits = collectCommits('a/v1.0.0..HEAD', dir);
    const scoped = scopeCommits('packages/a', commits, dir);

    expect(scoped.map((entry) => entry.message.split('\n')[0])).toEqual(['fix(a): a real package fix']);
  });

  test('a path-less commit is kept, because it carries no change of its own', () => {
    const scoped = scopeCommits(
      'packages/a',
      [{ hash: 'f'.repeat(40), message: 'chore: nothing at all', author: {}, committer: {} }],
      dir,
    );

    expect(scoped).toHaveLength(1);
  });

  test('the config narrows the range to the package and leaves publishing to the workflow', () => {
    const entry = RELEASE_PACKAGES[0];
    const config = packageReleaseConfig(entry);

    expect(config.tagFormat).toBe('plugin-sdk/v${version}');
    expect(config.analyzeCommits).toHaveLength(1);
    expect(typeof config.analyzeCommits[0][0]).toBe('function');
    expect(typeof config.generateNotes[0][0]).toBe('function');

    // The version writer is a local plugin, not `@semantic-release/npm`: that
    // plugin shells out to `npm version`, which refuses the `workspace:`
    // protocol this workspace declares (see release/version-package.mjs).
    expect(config.plugins.some((plugin) => typeof plugin === 'object' && 'prepare' in plugin)).toBe(true);
    expect(config.plugins).not.toContainEqual(['@semantic-release/npm', expect.anything()]);
    expect(config.plugins).toContainEqual([
      '@semantic-release/changelog',
      { changelogFile: 'packages/plugin-sdk/CHANGELOG.md', changelogTitle: expect.stringContaining('# @ompchamber/plugin-sdk') },
    ]);

    // `bun.lock` rides along, because the version plugin rewrites it and
    // `bun publish` reads a `workspace:` substitution from the lock rather than
    // from the manifest. An uncommitted refresh would re-publish the stale pin.
    const git = config.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === '@semantic-release/git');
    expect(git[1].assets).toContain('bun.lock');
  });
});

describe('package catalog', () => {
  test('names the directory and the manifest of every published package', () => {
    expect(RELEASE_PACKAGES.length).toBeGreaterThan(0);

    for (const entry of RELEASE_PACKAGES) {
      const manifest = JSON.parse(readFileSync(new URL(`../${entry.dir}/package.json`, import.meta.url), 'utf8'));

      expect(manifest.name).toBe(entry.name);
      // A private package has no version to release, and the local version
      // plugin refuses it rather than writing a version nobody can publish.
      expect(manifest.private).not.toBe(true);
      expect(manifest.publishConfig?.access).toBe('public');
    }
  });

  test('derives the tag prefix the workflow publishes on', () => {
    expect(RELEASE_PACKAGES.map(tagPrefix)).toEqual(['plugin-sdk', 'ui']);
  });
});

/**
 * A two-package workspace where `b` depends on `a` at `workspace:*` — the shape
 * `@ompchamber/ui` has on `@ompchamber/plugin-sdk`. Built from scratch so the
 * test does not depend on this repository's own versions.
 */
function makeWorkspace(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));

  const write = (rel, content) => {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), content);
  };

  const manifest = (extra) => `${JSON.stringify({ type: 'module', files: ['src'], exports: { '.': './src/index.js' }, ...extra }, null, 2)}\n`;

  write('package.json', `${JSON.stringify({ name: 'fixture', private: true, workspaces: ['packages/*'] }, null, 2)}\n`);
  write('packages/a/package.json', manifest({ name: 'a', version: '1.0.0' }));
  write('packages/a/src/index.js', 'export const a = 1;\n');
  write('packages/b/package.json', manifest({ name: 'b', version: '1.0.0', dependencies: { a: 'workspace:*' } }));
  write('packages/b/src/index.js', 'export const b = 1;\n');

  const installed = spawnSync(bunBin, ['install'], { cwd: dir, encoding: 'utf8' });

  if (installed.status !== 0) {
    throw new Error(`bun install failed:\n${installed.stderr}`);
  }

  return dir;
}

/** The version `b` declares for `a` in the tarball `bun pm pack` produces. */
function packedDependency(dir) {
  const cwd = join(dir, 'packages/b');
  const pack = spawnSync(bunBin, ['pm', 'pack'], { cwd, encoding: 'utf8' });

  if (pack.status !== 0) {
    throw new Error(`bun pm pack failed:\n${pack.stderr}`);
  }

  // `bun pm pack` prints the tarball name and then a size summary, so the name
  // is found by suffix rather than taken as the last line.
  const tarball = pack.stdout.split('\n').map((line) => line.trim()).find((line) => line.endsWith('.tgz'));

  if (!tarball) {
    throw new Error(`bun pm pack named no tarball:\n${pack.stdout}`);
  }

  const extracted = spawnSync('tar', ['-xOzf', tarball, 'package/package.json'], { cwd, encoding: 'utf8' });

  if (extracted.status !== 0) {
    throw new Error(`tar failed:\n${extracted.stderr}`);
  }

  return JSON.parse(extracted.stdout).dependencies.a;
}

describe('the local version plugin', () => {
  test('writes the version into the package manifest, and nothing else', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'ompchamber-version-'));
    const original = readFileSync(new URL('../packages/plugin-sdk/package.json', import.meta.url), 'utf8');

    try {
      mkdirSync(join(scratch, 'packages/plugin-sdk'), { recursive: true });
      writeFileSync(join(scratch, 'packages/plugin-sdk/package.json'), original);
      // The plugin refreshes the lockfile, which needs a workspace root.
      writeFileSync(join(scratch, 'package.json'), '{"name":"fixture","private":true}\n');

      const logs = [];
      versionPackagePlugin('packages/plugin-sdk').prepare({}, {
        cwd: scratch,
        nextRelease: { version: '9.9.9' },
        logger: { log: (message) => logs.push(message) },
      });

      const written = readFileSync(join(scratch, 'packages/plugin-sdk/package.json'), 'utf8');
      const before = JSON.parse(original);
      const after = JSON.parse(written);

      expect(after.version).toBe('9.9.9');
      // Only the version moved, and the file keeps its two-space indent and its
      // trailing newline — a release commit's diff is the version line alone.
      expect({ ...after, version: before.version }).toEqual(before);
      expect(written.endsWith('}\n')).toBe(true);
      expect(logs.join('\n')).toContain('9.9.9');
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  /**
   * The regression this plugin's lockfile refresh exists for.
   *
   * `bun.lock` records a version per workspace package, and `bun publish`
   * substitutes a `workspace:` spec from THAT record rather than from the
   * manifest. Measured in production: `@ompchamber/ui@2.0.0` went to npm
   * declaring `"@ompchamber/plugin-sdk": "1.0.0"` while the SDK was 2.0.0 on the
   * registry — an install that resolves the old SDK, which is precisely the
   * incompatibility the 2.0.0 release announced. Bumping the manifest without
   * refreshing the lock leaves the dependent package packing the old version.
   */
  test('refreshes bun.lock, so a dependent package packs the NEW version', () => {
    const scratch = makeWorkspace('ompchamber-lock-');

    try {
      expect(packedDependency(scratch)).toBe('1.0.0');

      versionPackagePlugin('packages/a').prepare({}, {
        cwd: scratch,
        nextRelease: { version: '2.0.0' },
        logger: { log() {} },
      });

      expect(packedDependency(scratch)).toBe('2.0.0');
      expect(readFileSync(join(scratch, 'bun.lock'), 'utf8')).toContain('2.0.0');
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  test('refuses a private package instead of writing a version nobody can publish', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'ompchamber-version-private-'));

    try {
      mkdirSync(join(scratch, 'packages/a'), { recursive: true });
      writeFileSync(join(scratch, 'packages/a/package.json'), '{"name":"a","version":"1.0.0","private":true}\n');

      expect(() =>
        versionPackagePlugin('packages/a').verifyConditions({}, { cwd: scratch, logger: { log() {} } }),
      ).toThrow(/private/);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
