/**
 * The bundled-plugin release, asserted.
 *
 * Two facts decide whether a plugin fix reaches an existing install, and both
 * are silent when wrong:
 *
 * 1. **The catalog and the tree must agree.** A plugin directory that no
 *    `BUNDLED_PLUGINS` row names is never bumped, so every fix to it ships
 *    without a version move — and `syncBundledPlugins` compares versions, so
 *    no installed copy ever receives it. Measured in this repository: the
 *    `stats` sticky-header fix and the `session-info` icon fix both landed
 *    with the version untouched.
 * 2. **The two version spellings in a manifest must agree.** `package.json`
 *    carries `version` and `kabmo.version`; the registry reads the SECOND
 *    (`toManifest` reads `pkg.kabmo`), and the sync compares it. Bumping
 *    only the first changes nothing on any machine, and nothing about the file
 *    looks wrong.
 *
 * The commit range is exercised against a THROWAWAY repository built in the
 * test, not against this one: a watermark is a fact about history, and a test
 * that read this repo's history would break the moment a commit landed and
 * would prove nothing about the code.
 */
import { expect, test, describe, afterEach } from 'bun:test';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { BUNDLED_PLUGINS, commitsSinceWatermark, versionWatermark } from './marketplace.js';
import { repoRoot } from './packages.mjs';

const scratch = [];

afterEach(() => {
  while (scratch.length > 0) rmSync(scratch.pop(), { recursive: true, force: true });
});

/** `git` with the machine's own config out of the way. */
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

/** A manifest with both version spellings, as a bundled plugin declares them. */
function manifest(version, extra = '') {
  return `${JSON.stringify({ name: 'p', version, kabmo: { id: 'p', version } }, null, 2)}\n${extra}`;
}

/**
 * A scratch repository with one plugin, so the watermark and the range can be
 * driven through commits that are exactly what the test wrote.
 */
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'kabmo-plugin-release-'));
  scratch.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.invalid');
  git(dir, 'config', 'user.name', 'Test');

  const plugin = 'marketplace/plugins/p';
  mkdirSync(join(dir, plugin), { recursive: true });
  writeFileSync(join(dir, plugin, 'package.json'), manifest('1.0.0'));
  writeFileSync(join(dir, plugin, 'app.tsx'), 'export const a = 1;\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'feat(p): add the plugin');

  return { dir, plugin };
}

describe('the catalog matches the tree', () => {
  test('every bundled plugin directory is listed, and its id is the manifest id', () => {
    const listed = new Set(BUNDLED_PLUGINS.map((entry) => entry.dir));
    const found = readdirSync(join(repoRoot, 'marketplace/plugins')).map(
      (name) => `marketplace/plugins/${name}`,
    );

    for (const dir of found) {
      expect(listed.has(dir), `${dir} exists but no BUNDLED_PLUGINS row names it — it would never be bumped`).toBe(true);
    }

    for (const entry of BUNDLED_PLUGINS) {
      const manifestPath = join(repoRoot, entry.dir, 'package.json');
      const parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));

      expect(found, `${entry.dir} is listed but does not exist`).toContain(entry.dir);
      // The plugin's identity is its manifest; `syncBundledPlugins` and the
      // registry both key on the manifest's own id, so a row that disagrees
      // would bump a directory nothing reads.
      expect(parsed.kabmo?.id, `${entry.dir} declares a different id`).toBe(entry.id);
    }
  });

  test('the two version spellings agree in every manifest', () => {
    for (const entry of BUNDLED_PLUGINS) {
      const parsed = JSON.parse(readFileSync(join(repoRoot, entry.dir, 'package.json'), 'utf8'));

      // A drift here is the bug the whole mechanism cannot see: the registry
      // reads `kabmo.version`, so a `version` bump alone is a no-op that
      // looks like a release.
      expect(
        parsed.version,
        `${entry.dir} declares version ${parsed.version} but kabmo.version ${parsed.kabmo?.version}`,
      ).toBe(parsed.kabmo?.version);
    }
  });

  test('every manifest is private, because a bundled plugin is never published', () => {
    // If one were publishable, the release would need a publish step and the
    // version would have to satisfy a registry too. Asserted so that a future
    // `private: false` is a deliberate change rather than a surprise.
    for (const entry of BUNDLED_PLUGINS) {
      const parsed = JSON.parse(readFileSync(join(repoRoot, entry.dir, 'package.json'), 'utf8'));

      expect(parsed.private, `${entry.dir} is not private`).toBe(true);
    }
  });
});

describe('the version watermark', () => {
  test('is the commit that last wrote the version, not the newest commit touching the file', () => {
    const { dir, plugin } = makeRepo();
    const bump = git(dir, 'log', '-1', '--format=%H').trim();

    // A later commit that does NOT touch the version line.
    writeFileSync(join(dir, plugin, 'app.tsx'), 'export const a = 2;\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'fix(p): change the app');

    expect(versionWatermark(plugin, dir)).toBe(bump);
  });

  test('moves to the bump commit once the version is rewritten', () => {
    const { dir, plugin } = makeRepo();
    writeFileSync(join(dir, plugin, 'app.tsx'), 'export const a = 2;\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'fix(p): change the app');

    writeFileSync(join(dir, plugin, 'package.json'), manifest('1.0.1'));
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'chore(release): p 1.0.1');
    const bump = git(dir, 'log', '-1', '--format=%H').trim();

    expect(versionWatermark(plugin, dir)).toBe(bump);
  });

  test('reports null for a manifest with no version line', () => {
    const { dir, plugin } = makeRepo();
    writeFileSync(join(dir, plugin, 'package.json'), `${JSON.stringify({ name: 'p' }, null, 2)}\n`);
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'chore(p): drop the version');

    expect(versionWatermark(plugin, dir)).toBeNull();
  });
});

describe('the commit range', () => {
  test('is empty right after the version was written', () => {
    const { dir, plugin } = makeRepo();

    expect(commitsSinceWatermark(plugin, dir)).toEqual([]);
  });

  test('is exactly the commits since the version was written', () => {
    const { dir, plugin } = makeRepo();

    writeFileSync(join(dir, plugin, 'app.tsx'), 'export const a = 2;\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'fix(p): first');
    writeFileSync(join(dir, plugin, 'app.tsx'), 'export const a = 3;\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'feat(p): second');

    const commits = commitsSinceWatermark(plugin, dir);

    // Newest first, and the version-write commit itself is excluded — it is the
    // range's lower bound, so re-releasing what was already released is not a
    // thing this can do.
    expect(commits.map((commit) => commit.message.split('\n')[0])).toEqual([
      'feat(p): second',
      'fix(p): first',
    ]);
  });

  test('ignores commits that did not touch the plugin', () => {
    const { dir, plugin } = makeRepo();

    writeFileSync(join(dir, 'README.md'), 'hello\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'docs: root readme');

    expect(commitsSinceWatermark(plugin, dir)).toEqual([]);
  });

  test('keeps a commit message whole, body and breaking footer included', () => {
    const { dir, plugin } = makeRepo();

    writeFileSync(join(dir, plugin, 'app.tsx'), 'export const a = 2;\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'feat(p)!: rewrite\n\nBREAKING CHANGE: the app entry moved.');

    const [commit] = commitsSinceWatermark(plugin, dir);

    // The analyzer reads the BODY for a breaking footer, so a range that
    // carried only subjects would silently downgrade a major bump to a minor.
    expect(commit.message).toContain('BREAKING CHANGE: the app entry moved.');
  });
});

describe('the bump level', () => {
  /**
   * The runner's own decision, driven through the real analyzer and the real
   * commit range — a scratch repository per case, so the answer is a fact about
   * the commits rather than a restatement of `release-rules.js`.
   */
  function typeFor(commits) {
    const { dir, plugin } = makeRepo();
    for (const message of commits) {
      writeFileSync(join(dir, plugin, 'app.tsx'), `export const a = ${Math.random()};\n`);
      git(dir, 'add', '-A');
      git(dir, 'commit', '-q', '-m', message);
    }
    return commitsSinceWatermark(plugin, dir);
  }

  test('a fix is a patch, a feat is a minor, a breaking footer is a major', async () => {
    const { analyzeCommits } = await import('@semantic-release/commit-analyzer');
    // The shared export, not a scan of `plugins`: the app's analyzer is a step
    // key now (`release/app-scope.js`), so a lookup by plugin name finds nothing.
    const { analyzerOptions: config } = await import('../release.config.mjs');

    const level = async (messages) => {
      const commits = typeFor(messages);
      return analyzeCommits(config, {
        commits: commits.map((commit) => ({ ...commit, subject: commit.message.split('\n')[0], notes: [] })),
        cwd: repoRoot,
        options: {},
        logger: { log() {} },
      });
    };

    expect(await level(['fix(p): correct the count'])).toBe('patch');
    expect(await level(['feat(p): add a column'])).toBe('minor');
    expect(await level(['feat(p)!: rewrite\n\nBREAKING CHANGE: the entry moved.'])).toBe('major');
    // A type that cannot release asks for nothing, so the runner must leave the
    // version alone rather than shipping a no-op update to every user.
    expect(await level(['docs(p): explain the panel'])).toBe(null);
    expect(await level(['test(p): cover the row'])).toBe(null);
  });
});
