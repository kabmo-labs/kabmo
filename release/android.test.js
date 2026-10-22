/**
 * The Android shell's release identity, asserted.
 *
 * The APK is not published anywhere, so the version it declares is the whole
 * delivery mechanism — and the failure it can cause is silent in a way nothing
 * else in this repository is. Two readers depend on the number moving:
 *
 * - the console compares the published asset's version
 *   (`versionFromAssetName('android', …)`) against the one the running app reports on
 *   its User-Agent, and offers a download only when the published one is NEWER. A
 *   shell fix whose version did not move is an update no installed app is ever told
 *   about.
 * - `publish-android.yml` names the asset from the same file, so a name taken
 *   from anywhere else makes the comparison meaningless rather than broken.
 *
 * The commit range is exercised against a THROWAWAY repository, not this one: a
 * watermark is a fact about history, and a test that read this repo's history
 * would break the moment a commit landed and would prove nothing about the code.
 */
import { expect, test, describe, afterEach } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  ANDROID_SHELL,
  commitsSinceWatermark,
  readVersionName,
  replaceVersionLine,
  versionWatermark,
} from './android.js';
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

/** The properties file, with a comment line above the version. */
function properties(version) {
  return `# shell version\nversionName=${version}\n`;
}

/** A scratch repository with the shell directory, so the range can be driven. */
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'kabmo-android-release-'));
  scratch.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.invalid');
  git(dir, 'config', 'user.name', 'Test');

  mkdirSync(join(dir, ANDROID_SHELL.dir), { recursive: true });
  writeFileSync(join(dir, ANDROID_SHELL.versionFile), properties('0.3.0'));
  writeFileSync(join(dir, ANDROID_SHELL.dir, 'Shell.kt'), 'val a = 1\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'feat(android): add the shell');

  return dir;
}

describe('the shell version is one declared fact', () => {
  test('version.properties exists, is a three-part version, and is what the build reads', () => {
    const text = readFileSync(join(repoRoot, ANDROID_SHELL.versionFile), 'utf8');
    const version = readVersionName(text);

    expect(version, `${ANDROID_SHELL.versionFile} declares no versionName`).not.toBeNull();
    expect(version, 'the shell version must be a three-part version').toMatch(/^\d+\.\d+\.\d+$/);

    // The build must take `versionName` from the FILE. A `-P` flag would make the
    // number the pipeline publishes and the number the app reports on its UA two
    // separate decisions, which is the bug this replaced.
    const gradle = readFileSync(join(repoRoot, ANDROID_SHELL.dir, 'app/build.gradle.kts'), 'utf8');
    expect(gradle, 'the build must read version.properties').toContain('version.properties');
    expect(gradle, 'the build must not take versionName from a -P flag').not.toContain('kabmoVersionName');
  });

  test('the APK workflow names the asset from that file, not from the release tag', () => {
    // The console reads the published version out of the asset NAME, so a name
    // carrying the app's tag would compare a server version against the version
    // the shell reports.
    const workflow = readFileSync(join(repoRoot, '.github/workflows/publish-android.yml'), 'utf8');

    expect(workflow).toContain('version.properties');
    expect(workflow, 'the asset name must come from the shell version').toContain(
      'kabmo-android-v${version}.apk',
    );
    expect(workflow, 'the APK must not be built with the release tag as its version').not.toContain(
      'kabmoVersionName',
    );
  });

  test('the APK workflow reads the version through the tested reader, never through sed', () => {
    // Measured on the v0.3.0 release: the inline read was
    // `sed -n 's/^versionName=//p' | sed 's/[[:space:]]*$//' version.properties`.
    // `sed -n` with no FILE argument reads STDIN, so the first stage consumed
    // the pipeline's input and printed nothing, the second stage read that empty
    // stream, and `version` came out EMPTY — the verify step then grepped the
    // APK's badging for the literal string `versionName=0.3.0` and failed with
    // `versionName is not versionName=0.3.0`. Every read of that file must go
    // through `release/android-version.mjs`, which is `readVersionName`.
    const workflow = readFileSync(join(repoRoot, '.github/workflows/publish-android.yml'), 'utf8');

    expect(workflow, 'every version read must use the shared reader').toContain(
      'node release/android-version.mjs',
    );
    // A pipeline stage that names the file AFTER a `sed -n` that has no file of
    // its own is the exact shape that failed. Any `sed` touching the properties
    // file is refused outright: there is one parser and this is not it.
    expect(workflow, 'the workflow must not parse version.properties with sed').not.toMatch(
      /sed[^\n]*version\.properties/,
    );
  });
});

describe('reading and rewriting the version line', () => {
  test('the CLI prints the version and nothing else', () => {
    // The workflow captures this with `$( … )`, so a trailing newline or any
    // other output would land INSIDE the version string and make the `aapt2`
    // comparison fail on whitespace. Run as a real process for that reason:
    // calling `readVersionName` in-process proves nothing about what the shell
    // captures.
    const dir = mkdtempSync(join(tmpdir(), 'kabmo-android-cli-'));
    scratch.push(dir);
    const file = join(dir, 'version.properties');
    writeFileSync(file, properties('1.2.3'));

    const result = spawnSync(process.execPath, [join(repoRoot, 'release/android-version.mjs'), '--file', file], {
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('1.2.3');
  });

  test('the CLI exits 1 and says why when the file declares no version', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kabmo-android-cli-'));
    scratch.push(dir);
    const file = join(dir, 'version.properties');
    writeFileSync(file, '# dropped\n');

    const result = spawnSync(process.execPath, [join(repoRoot, 'release/android-version.mjs'), '--file', file], {
      encoding: 'utf8',
    });

    // An EMPTY stdout is what made the original release failure unreadable: the
    // verify step compared against `''` and reported the mismatch as if the APK
    // were wrong.
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('declares no versionName');
  });

  test('reads the value, ignoring comments and surrounding space', () => {
    expect(readVersionName('# a comment\nversionName=1.2.3\n')).toBe('1.2.3');
    expect(readVersionName('  versionName = 1.2.3  \n')).toBe('1.2.3');
    expect(readVersionName('# versionName=9.9.9\nversionName=1.2.3\n')).toBe('1.2.3');
  });

  test('reports null when the line is absent or empty', () => {
    expect(readVersionName('# nothing here\n')).toBeNull();
    expect(readVersionName('versionName=\n')).toBeNull();
  });

  test('rewrites exactly the version line and keeps the comments', () => {
    const text = properties('0.3.0');
    const out = replaceVersionLine(text, '0.3.0', '0.3.1');

    expect(out).toContain('versionName=0.3.1');
    expect(out).toContain('# shell version');
    expect(readVersionName(out)).toBe('0.3.1');
    // The newline must survive: a `\s*$` anchor swallows it, and the bump would
    // then be the only line in the file with no terminator.
    expect(out.endsWith('\n')).toBe(true);
    expect(out.split('\n').length).toBe(text.split('\n').length);
  });

  test('refuses to write when the expected version is not there', () => {
    // A partial rewrite is the drift this guards: the file would then declare a
    // version the pipeline never decided, and nothing downstream could see it.
    expect(() => replaceVersionLine(properties('0.3.0'), '9.9.9', '9.9.10')).toThrow(/rewrote 0/);
  });

  test('keeps a hand-aligned separator, and does not match a longer key', () => {
    const aligned = '# shell version\nversionName = 0.3.0\n';
    expect(replaceVersionLine(aligned, '0.3.0', '0.3.1')).toBe('# shell version\nversionName = 0.3.1\n');

    // `minVersionName=` must not be rewritten: an anchored prefix would match it
    // and the bump would land on a line nothing reads.
    expect(() => replaceVersionLine('minVersionName=0.3.0\n', '0.3.0', '0.3.1')).toThrow(/rewrote 0/);
  });
});

describe('the version watermark', () => {
  test('is the commit that wrote the version, not the newest commit in the directory', () => {
    const dir = makeRepo();
    const add = git(dir, 'log', '-1', '--format=%H').trim();

    writeFileSync(join(dir, ANDROID_SHELL.dir, 'Shell.kt'), 'val a = 2\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'fix(android): tweak the shell');

    expect(versionWatermark(dir)).toBe(add);
  });

  test('moves to the bump commit once the version is rewritten', () => {
    const dir = makeRepo();
    writeFileSync(join(dir, ANDROID_SHELL.dir, 'Shell.kt'), 'val a = 2\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'fix(android): tweak the shell');

    writeFileSync(join(dir, ANDROID_SHELL.versionFile), properties('0.3.1'));
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'chore(release): bump the android shell (0.3.1)');
    const bump = git(dir, 'log', '-1', '--format=%H').trim();

    expect(versionWatermark(dir)).toBe(bump);
  });

  test('reports null for a file with no version line', () => {
    const dir = makeRepo();
    writeFileSync(join(dir, ANDROID_SHELL.versionFile), '# dropped\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'chore(android): drop the version');

    expect(versionWatermark(dir)).toBeNull();
  });
});

describe('the commit range', () => {
  test('is empty right after the version was written', () => {
    expect(commitsSinceWatermark(makeRepo())).toEqual([]);
  });

  test('is exactly the commits since the version was written, newest first', () => {
    const dir = makeRepo();

    writeFileSync(join(dir, ANDROID_SHELL.dir, 'Shell.kt'), 'val a = 2\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'fix(android): first');
    writeFileSync(join(dir, ANDROID_SHELL.dir, 'Shell.kt'), 'val a = 3\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'feat(android): second');

    expect(commitsSinceWatermark(dir).map((commit) => commit.message.split('\n')[0])).toEqual([
      'feat(android): second',
      'fix(android): first',
    ]);
  });

  test('ignores commits outside the shell directory, and does not re-release the bump itself', () => {
    const dir = makeRepo();

    writeFileSync(join(dir, 'README.md'), 'hello\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'docs: root readme');

    expect(commitsSinceWatermark(dir)).toEqual([]);

    // A bump commit touches version.properties, which is INSIDE the directory —
    // it must still not appear in the next range, or every release would re-bump
    // on the previous one's commit.
    writeFileSync(join(dir, ANDROID_SHELL.versionFile), properties('0.3.1'));
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'chore(release): bump the android shell (0.3.1)');

    expect(commitsSinceWatermark(dir)).toEqual([]);
  });
});
