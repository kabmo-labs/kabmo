/**
 * The app release's commit scope, asserted.
 *
 * The app's range is every commit since its last `v*` tag, so it contains work
 * that belongs to artifacts with a release channel of their own. The Android
 * shell is the one that matters: `release/release-android.mjs` bumps its version
 * from its own commits and `shell-release` publishes an APK for it, so a
 * `fix(android): …` push would otherwise ALSO cut an app version and publish it
 * to npm.
 *
 * Everything here runs against a THROWAWAY repository, for the reason
 * `release/packages.test.js` documents: a range is a fact about history, and a
 * test that read this repo's tags would break the moment a tag moved while
 * proving nothing about the code.
 */
import { expect, test, describe, beforeAll, afterAll } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { APP_INDEPENDENT_TREES, scopeAppCommits, scopedAnalyzeAppCommits } from './app-scope.js';
import { collectCommits } from './commits.js';
import config, { analyzerOptions } from '../release.config.mjs';

/** `git` with the machine's own config out of the way. */
function git(dir, ...args) {
  const result = spawnSync('git', ['-C', dir, ...args], {
    encoding: 'utf8',
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

const subjects = (commits) => commits.map((entry) => entry.message.split('\n')[0]);

describe('the app release scope', () => {
  /** @type {string} */
  let dir;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'kabmo-app-scope-'));
    git(dir, 'init', '-q', '--initial-branch=main');

    commit(dir, 'feat(app): a real app change', { 'src/app.ts': 'export const app = 1;\n' });
    git(dir, 'tag', 'v1.0.0');

    commit(dir, 'fix(android): only the shell changed', {
      'packages/android/version.properties': 'versionName=1.0.1\n',
    });
    commit(dir, 'feat(panels): a bundled plugin change', {
      'marketplace/plugins/stats/package.json': '{ "version": "1.1.0" }\n',
    });
    commit(dir, 'fix(server): an app fix', { 'src/server/index.ts': 'export const x = 2;\n' });
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('a shell-only commit is not an app commit', () => {
    const scoped = scopeAppCommits(collectCommits('v1.0.0..HEAD', dir), dir);

    expect(subjects(scoped)).not.toContain('fix(android): only the shell changed');
  });

  test('a bundled plugin is NOT an independent tree, because the app is its release vehicle', () => {
    // `syncBundledPlugins` compares the store's version against the installed
    // one, and the store ships inside the app's tarball — so a plugin bump that
    // did not release the app would reach no installed copy at all.
    expect(APP_INDEPENDENT_TREES).toEqual(['packages/android']);

    const scoped = scopeAppCommits(collectCommits('v1.0.0..HEAD', dir), dir);

    expect(subjects(scoped)).toContain('feat(panels): a bundled plugin change');
  });

  test('a commit that touches the app AND the shell is an app commit', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'kabmo-app-scope-mixed-'));

    try {
      git(scratch, 'init', '-q', '--initial-branch=main');
      commit(scratch, 'feat(app): a first change', { 'src/app.ts': 'export const app = 1;\n' });
      git(scratch, 'tag', 'v1.0.0');
      commit(scratch, 'feat: change the app and the shell together', {
        'src/app.ts': 'export const app = 2;\n',
        'packages/android/version.properties': 'versionName=1.0.1\n',
      });

      const scoped = scopeAppCommits(collectCommits('v1.0.0..HEAD', scratch), scratch);

      expect(subjects(scoped)).toEqual(['feat: change the app and the shell together']);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  test('a shell commit that also edits notes, workflows or release tooling is still a shell commit', () => {
    // Measured on this repository: eight of the nine shell commits in
    // `v0.0.1..HEAD` carry `AGENTS.md`, `packages/android/README.md`, `release/`
    // or `.github/workflows/` beside their Kotlin. A rule that required every
    // path to sit inside `packages/android` would have kept cutting app
    // versions for all of them.
    const scratch = mkdtempSync(join(tmpdir(), 'kabmo-app-scope-meta-'));

    try {
      git(scratch, 'init', '-q', '--initial-branch=main');
      commit(scratch, 'feat(app): a first change', { 'src/app.ts': 'export const app = 1;\n' });
      git(scratch, 'tag', 'v1.0.0');
      commit(scratch, 'fix(android): a shell fix that documents itself', {
        'packages/android/app/Main.kt': 'class Main\n',
        'AGENTS.md': '# notes\n',
        'release/android.js': 'export const x = 1;\n',
        '.github/workflows/publish-android.yml': 'name: Publish\n',
      });

      expect(scopeAppCommits(collectCommits('v1.0.0..HEAD', scratch), scratch)).toEqual([]);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  test('a shell commit that also changes shipped source is an app commit', () => {
    // The case the rule must NOT drop: the console's APK probe and the shell
    // moving together is a real app change.
    const scratch = mkdtempSync(join(tmpdir(), 'kabmo-app-scope-surface-'));

    try {
      git(scratch, 'init', '-q', '--initial-branch=main');
      commit(scratch, 'feat(app): a first change', { 'src/app.ts': 'export const app = 1;\n' });
      git(scratch, 'tag', 'v1.0.0');
      commit(scratch, 'feat(android): read the new UA token', {
        'packages/android/app/Main.kt': 'class Main\n',
        'src/server/lib/updates/android-release.ts': 'export const token = 1;\n',
      });

      expect(subjects(scopeAppCommits(collectCommits('v1.0.0..HEAD', scratch), scratch))).toEqual([
        'feat(android): read the new UA token',
      ]);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  test('a path-less commit is kept, because it carries no change of its own', () => {
    // A merge or an empty commit. Dropping it would also drop a `revert` git
    // recorded without a diff — the same rule `scopeCommits` follows.
    const scoped = scopeAppCommits(
      [{ hash: 'f'.repeat(40), message: 'revert: undo it', author: {}, committer: {} }],
      dir,
    );

    expect(scoped).toHaveLength(1);
  });

  test('an empty range stays empty rather than asking git about nothing', () => {
    expect(scopeAppCommits([], dir)).toEqual([]);
  });

  test('a shell-only range leaves the app with nothing to release', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'kabmo-app-scope-shell-'));

    try {
      git(scratch, 'init', '-q', '--initial-branch=main');
      commit(scratch, 'feat(app): a first change', { 'src/app.ts': 'export const app = 1;\n' });
      git(scratch, 'tag', 'v1.0.0');
      commit(scratch, 'fix(android): a shell-only fix', {
        'packages/android/app/Main.kt': 'class Main\n',
      });

      expect(scopeAppCommits(collectCommits('v1.0.0..HEAD', scratch), scratch)).toEqual([]);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  test('the analyzer step releases nothing for a shell-only range, and a patch for an app fix', async () => {
    // The filter above is the mechanism; this is the OUTCOME semantic-release
    // reads. Driven through the real analyzer and the config's own options, so a
    // wrapper that scoped the notes but not the version — or vice versa — fails
    // here rather than in production.
    const scratch = mkdtempSync(join(tmpdir(), 'kabmo-app-scope-analyzer-'));

    try {
      git(scratch, 'init', '-q', '--initial-branch=main');
      commit(scratch, 'feat(app): a first change', { 'src/app.ts': 'export const app = 1;\n' });
      git(scratch, 'tag', 'v1.0.0');
      commit(scratch, 'fix(android): a shell-only fix', {
        'packages/android/app/Main.kt': 'class Main\n',
      });

      const shellOnly = await scopedAnalyzeAppCommits()(analyzerOptions, {
        commits: collectCommits('v1.0.0..HEAD', scratch),
        cwd: scratch,
        options: {},
        logger: { log() {} },
      });

      expect(shellOnly, 'a shell-only push must cut no app version').toBe(null);

      commit(scratch, 'fix(server): an app fix', { 'src/server/index.ts': 'export const x = 2;\n' });

      const withAppFix = await scopedAnalyzeAppCommits()(analyzerOptions, {
        commits: collectCommits('v1.0.0..HEAD', scratch),
        cwd: scratch,
        options: {},
        logger: { log() {} },
      });

      expect(withAppFix).toBe('patch');
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

describe('the app config wires the scope in', () => {
  test('the analyzer and the notes generator are STEP keys, not plugins entries', () => {
    // semantic-release validates a `plugins` entry differently from a step entry:
    // `validatePlugin` refuses a function, so a scoped wrapper can only live on
    // the step keys. Both must be there — a scoped analyzer with an unscoped
    // notes generator writes a changelog full of shell fixes into an app release
    // that has none of them.
    expect(typeof config.analyzeCommits?.[0]?.[0]).toBe('function');
    expect(typeof config.generateNotes?.[0]?.[0]).toBe('function');

    // And they carry the shared options, so a `feat` still means a minor.
    expect(config.analyzeCommits[0][1]).toEqual(analyzerOptions);
    expect(config.generateNotes[0][1]).toEqual(expect.objectContaining({ preset: 'conventionalcommits' }));

    const pluginNames = config.plugins.map((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin));
    expect(pluginNames, 'the analyzer must not also sit in plugins').not.toContain(
      '@semantic-release/commit-analyzer',
    );
    expect(pluginNames, 'the notes generator must not also sit in plugins').not.toContain(
      '@semantic-release/release-notes-generator',
    );
  });
});
