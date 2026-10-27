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
import {
  commitRelease,
  createGithubReleases,
  releaseAssets,
  releaseCommitMessage,
  releaseTags,
} from './packages-commit.js';
import { packageReleaseConfig, scopeCommits, writePackageRelease } from './packages.mjs';
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
    // `NUL` on Windows: there is no `/dev/null`, and git treats the path as a
    // CONFIG FILE — a missing one is an error, so `git add` failed with an empty
    // stderr and took the whole release-tooling suite with it.
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
      GIT_CONFIG_SYSTEM: process.platform === 'win32' ? 'NUL' : '/dev/null',
    },
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
    dir = mkdtempSync(join(tmpdir(), 'kabmo-release-'));
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
    const scratch = mkdtempSync(join(tmpdir(), 'kabmo-release-empty-'));

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

  test('the config only DECIDES: it narrows the range and carries no git side effects', () => {
    const entry = RELEASE_PACKAGES[0];
    const config = packageReleaseConfig(entry);

    expect(config.tagFormat).toBe('kabmo-sdk/v${version}');
    expect(config.analyzeCommits).toHaveLength(1);
    expect(typeof config.analyzeCommits[0][0]).toBe('function');
    expect(typeof config.generateNotes[0][0]).toBe('function');

    // Analysis only, with an EXPLICIT empty plugin list: semantic-release falls
    // back to its defaults (`npm` + `github`) for a nil `plugins`, and merges the
    // repository's own `release.config.mjs` under these options — either one
    // would run the APP's release plugins for a package. In a dry run the
    // `prepare` step does not run at all, so a plugin list here would be
    // misleading even when it is ours: the writes are `writePackageRelease`'s
    // and the git work is `packages-commit.js`'s.
    expect(config.plugins).toEqual([]);
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
    expect(RELEASE_PACKAGES.map(tagPrefix)).toEqual(['kabmo-sdk', 'kabmo-ui']);
  });
});

/**
 * A two-package workspace where `b` depends on `a` at `workspace:*` — the shape
 * `@kabmo-labs/kabmo-ui` has on `@kabmo-labs/kabmo-sdk`. Built from scratch so the
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
    const scratch = mkdtempSync(join(tmpdir(), 'kabmo-version-'));
    const original = readFileSync(new URL('../packages/kabmo-sdk/package.json', import.meta.url), 'utf8');

    try {
      mkdirSync(join(scratch, 'packages/kabmo-sdk'), { recursive: true });
      writeFileSync(join(scratch, 'packages/kabmo-sdk/package.json'), original);
      // The plugin refreshes the lockfile, which needs a workspace root.
      writeFileSync(join(scratch, 'package.json'), '{"name":"fixture","private":true}\n');

      const logs = [];
      versionPackagePlugin('packages/kabmo-sdk').prepare({}, {
        cwd: scratch,
        nextRelease: { version: '9.9.9' },
        logger: { log: (message) => logs.push(message) },
      });

      const written = readFileSync(join(scratch, 'packages/kabmo-sdk/package.json'), 'utf8');
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
   * manifest. Measured in production: `@kabmo-labs/kabmo-ui@2.0.0` went to npm
   * declaring `"@kabmo-labs/kabmo-sdk": "1.0.0"` while the SDK was 2.0.0 on the
   * registry — an install that resolves the old SDK, which is precisely the
   * incompatibility the 2.0.0 release announced. Bumping the manifest without
   * refreshing the lock leaves the dependent package packing the old version.
   */
  // POSIX-only: the fixture is a bun WORKSPACE, and `bun install` links its
  // packages with a SYMLINK — which a default Windows runner cannot create
  // (`failed to symlink dependencies … (symlink)`). The lockfile refresh itself
  // is exercised by the production release run, which has the privilege.
  const testPosix = process.platform === 'win32' ? test.skip : test;
  testPosix('refreshes bun.lock, so a dependent package packs the NEW version', () => {
    const scratch = makeWorkspace('kabmo-lock-');

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
    const scratch = mkdtempSync(join(tmpdir(), 'kabmo-version-private-'));

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

describe('the one commit every released package shares', () => {
  const sdk = {
    entry: { dir: 'packages/kabmo-sdk', name: '@kabmo-labs/kabmo-sdk' },
    tag: 'kabmo-sdk/v0.1.1',
    version: '0.1.1',
    notes: 'sdk notes',
  };
  const ui = {
    entry: { dir: 'packages/kabmo-ui', name: '@kabmo-labs/kabmo-ui' },
    tag: 'kabmo-ui/v0.2.1',
    version: '0.2.1',
    notes: 'ui notes',
  };

  /** Record every `git` call instead of running it. */
  function recorder() {
    const calls = [];

    return { calls, git: (args) => calls.push(args) };
  }

  test('names every tag in one subject, and stages one bun.lock', () => {
    // Two packages, one release run: the subject is the release note for the SET,
    // and `[skip ci]` is what keeps the bump commit from re-triggering the
    // workflow that produced it.
    expect(releaseTags([sdk, ui])).toEqual(['kabmo-sdk/v0.1.1', 'kabmo-ui/v0.2.1']);
    expect(releaseCommitMessage([sdk, ui])).toBe(
      'chore(release): kabmo-sdk/v0.1.1, kabmo-ui/v0.2.1 [skip ci]',
    );

    // `bun.lock` rides along once, because the version plugin rewrites it and
    // `bun publish` reads a `workspace:` substitution from the lock rather than
    // from the manifest.
    const assets = releaseAssets([sdk, ui]);
    expect(assets).toEqual([
      'packages/kabmo-sdk/CHANGELOG.md',
      'packages/kabmo-sdk/package.json',
      'packages/kabmo-ui/CHANGELOG.md',
      'packages/kabmo-ui/package.json',
      'bun.lock',
    ]);
    expect(assets.filter((asset) => asset === 'bun.lock')).toHaveLength(1);
  });

  test('makes ONE commit, tags both releases at it, and pushes them atomically', () => {
    // The shape this change exists for: `@semantic-release/git` committed and
    // pushed once PER package, so one decision produced two commits and two
    // pushes. One `git add` and one `git commit` for the whole set is the
    // contract; the tags must point at that commit, not at the pre-bump one.
    const { calls, git } = recorder();

    const result = commitRelease({ released: [sdk, ui], git, exists: () => true });

    expect(calls.filter((args) => args[0] === 'add')).toHaveLength(1);
    expect(calls.filter((args) => args[0] === 'commit')).toHaveLength(1);

    const add = calls.find((args) => args[0] === 'add');
    for (const asset of releaseAssets([sdk, ui])) {
      expect(add, `${asset} must be staged`).toContain(asset);
    }
    expect(add).not.toContain('-A');

    const commit = calls.find((args) => args[0] === 'commit');
    expect(commit).toContain(releaseCommitMessage([sdk, ui]));

    const tags = calls.filter((args) => args[0] === 'tag');
    expect(tags).toEqual([
      ['tag', 'kabmo-sdk/v0.1.1', 'HEAD'],
      ['tag', 'kabmo-ui/v0.2.1', 'HEAD'],
    ]);

    // ONE push, with the branch and both tags, `--atomic`: a rejected tag must
    // not leave the branch moved without the release it describes.
    const pushes = calls.filter((args) => args[0] === 'push');
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toEqual([
      'push',
      '--atomic',
      'origin',
      'HEAD:main',
      'kabmo-sdk/v0.1.1',
      'kabmo-ui/v0.2.1',
    ]);

    expect(result?.tags).toEqual(['kabmo-sdk/v0.1.1', 'kabmo-ui/v0.2.1']);
  });

  test('skips an asset that was never written, instead of failing on it', () => {
    // The changelog plugin writes nothing when the notes are empty, and
    // `git add <missing>` is fatal — the release would fail over a file nobody
    // was going to read. `@semantic-release/git` matched only the paths that
    // changed, which is the behaviour this reproduces.
    const { calls, git } = recorder();
    const missing = 'packages/kabmo-ui/CHANGELOG.md';

    commitRelease({ released: [sdk, ui], git, exists: (asset) => asset !== missing });

    const add = calls.find((args) => args[0] === 'add');
    expect(add).not.toContain(missing);
    expect(add).toContain('packages/kabmo-ui/package.json');
    expect(add).toContain('bun.lock');
  });

  test('nothing released means no git command at all', () => {
    const { calls, git } = recorder();

    expect(commitRelease({ released: [], git })).toBeNull();
    expect(calls).toEqual([]);
  });

  test('creates one release page per tag, with its own notes', async () => {
    const requests = [];
    const fetchImpl = async (url, init) => {
      requests.push({ url, init });
      return { ok: true, status: 201, text: async () => '' };
    };

    const created = await createGithubReleases({
      released: [sdk, ui],
      token: 't0ken',
      repository: 'kabmo-labs/kabmo',
      fetchImpl,
    });

    expect(created).toEqual(['kabmo-sdk/v0.1.1', 'kabmo-ui/v0.2.1']);
    expect(requests).toHaveLength(2);
    expect(requests[0].url).toBe('https://api.github.com/repos/kabmo-labs/kabmo/releases');
    expect(requests[0].init.headers.authorization).toBe('Bearer t0ken');
    expect(JSON.parse(requests[0].init.body)).toEqual({
      tag_name: 'kabmo-sdk/v0.1.1',
      name: 'kabmo-sdk/v0.1.1',
      body: 'sdk notes',
    });
    expect(JSON.parse(requests[1].init.body).tag_name).toBe('kabmo-ui/v0.2.1');
  });

  test('a release page that already exists is the state we want, not a failure', async () => {
    const fetchImpl = async () => ({
      ok: false,
      status: 422,
      text: async () => '{"errors":[{"code":"already_exists"}]}',
    });

    const created = await createGithubReleases({
      released: [sdk],
      token: 't0ken',
      repository: 'kabmo-labs/kabmo',
      fetchImpl,
    });

    expect(created).toEqual(['kabmo-sdk/v0.1.1']);
  });

  test('reports a refused release page instead of pretending it exists', async () => {
    const fetchImpl = async () => ({ ok: false, status: 403, text: async () => 'Resource not accessible' });

    await expect(
      createGithubReleases({ released: [sdk], token: 't0ken', repository: 'kabmo-labs/kabmo', fetchImpl }),
    ).rejects.toThrow(/403 Resource not accessible/);
  });

  test('refuses to guess the repository or the token', async () => {
    const fetchImpl = async () => {
      throw new Error('must not be called');
    };

    await expect(createGithubReleases({ released: [sdk], token: undefined, repository: 'a/b', fetchImpl })).rejects.toThrow(
      /GITHUB_TOKEN/,
    );
    await expect(
      createGithubReleases({ released: [sdk], token: 't0ken', repository: undefined, fetchImpl }),
    ).rejects.toThrow(/GITHUB_REPOSITORY/);
  });
});

describe('writing one package release', () => {
  const testPosix = process.platform === 'win32' ? test.skip : test;

  testPosix('writes the version, the refreshed lock and the changelog in one call', async () => {
    // The two writers are the plugins the per-package runs used, called
    // directly: semantic-release's `prepare` step does not run in a dry run, so
    // calling the changelog plugin is what keeps the file byte-identical.
    const scratch = makeWorkspace('kabmo-write-');

    try {
      const wrote = await writePackageRelease({
        entry: { dir: 'packages/a', name: '@kabmo-labs/a' },
        nextRelease: {
          version: '2.0.0',
          notes: '## [2.0.0](https://example.test/a/v2.0.0) (2026-10-27)\n\n### Fixed\n\n* a thing',
        },
        cwd: scratch,
      });

      expect(wrote).toBe(true);
      expect(JSON.parse(readFileSync(join(scratch, 'packages/a/package.json'), 'utf8')).version).toBe('2.0.0');
      // A dependent package pins from the LOCK, not from the manifest, so the
      // refresh is part of the write and not a separate step someone can forget.
      expect(readFileSync(join(scratch, 'bun.lock'), 'utf8')).toContain('2.0.0');

      const changelog = readFileSync(join(scratch, 'packages/a/CHANGELOG.md'), 'utf8');
      expect(changelog).toContain('# @kabmo-labs/a');
      expect(changelog).toContain('### Fixed');
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  test('a rehearsal writes nothing', async () => {
    // `--dry-run` must leave no trace: the root below does not exist, so a write
    // would throw rather than pass silently.
    const wrote = await writePackageRelease({
      entry: { dir: 'packages/a', name: '@kabmo-labs/a' },
      nextRelease: { version: '9.9.9', notes: 'nope' },
      cwd: join(tmpdir(), 'kabmo-does-not-exist'),
      write: false,
    });

    expect(wrote).toBe(false);
  });
});
