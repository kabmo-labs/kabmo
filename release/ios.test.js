/**
 * The iOS shell's release identity, asserted.
 *
 * The IPA is not published anywhere, so the version it declares is the whole
 * delivery mechanism — and the failure it can cause is silent in a way nothing else
 * in this repository is. Two readers depend on the number moving:
 *
 * - the console compares the published asset's version (`versionFromAssetName('ios')`)
 *   against the one the running app reports on its User-Agent, and offers a download
 *   only when the published one is NEWER. A shell fix whose version did not move is
 *   an update no installed app is ever told about.
 * - `scripts/build-ipa.sh` writes it into `CFBundleShortVersionString` and
 *   `publish-ios.yml` names the asset from the same file, so a name taken from
 *   anywhere else makes the comparison meaningless rather than broken.
 *
 * The commit range is exercised against a THROWAWAY repository, not this one: a
 * watermark is a fact about history, and a test that read this repo's history would
 * break the moment a commit landed and would prove nothing about the code.
 */
import { expect, test, describe, afterEach } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  IOS_SHELL,
  commitsSinceWatermark,
  readVersionName,
  replaceVersionLine,
  versionWatermark,
} from './ios.js';
import { repoRoot } from './packages.mjs';

const scratch = [];

afterEach(() => {
  while (scratch.length > 0) rmSync(scratch.pop(), { recursive: true, force: true });
});

/** `git` with the machine's own config out of the way. */
function git(dir, ...args) {
  const result = spawnSync('git', ['-C', dir, ...args], {
    encoding: 'utf8',
    // `NUL` on Windows: there is no `/dev/null`, and git treats the path as a CONFIG
    // FILE — a missing one is an error, so `git add` failed with an empty stderr and
    // took the whole release-tooling suite with it.
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
  const dir = mkdtempSync(join(tmpdir(), 'kabmo-ios-release-'));
  scratch.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.invalid');
  git(dir, 'config', 'user.name', 'Test');

  mkdirSync(join(dir, IOS_SHELL.dir), { recursive: true });
  writeFileSync(join(dir, IOS_SHELL.versionFile), properties('0.1.0'));
  writeFileSync(join(dir, IOS_SHELL.dir, 'Shell.swift'), 'let a = 1\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'feat(ios): add the shell');

  return dir;
}

describe('the shell version is one declared fact', () => {
  test('version.properties exists, is a three-part version, and is what the build reads', () => {
    const text = readFileSync(join(repoRoot, IOS_SHELL.versionFile), 'utf8');
    const version = readVersionName(text);

    expect(version, `${IOS_SHELL.versionFile} declares no versionName`).not.toBeNull();
    expect(version, 'the shell version must be a three-part version').toMatch(/^\d+\.\d+\.\d+$/);

    // The build must take the version from the FILE, through the shared reader. A
    // `-P`-style argument would make the number the pipeline publishes and the number
    // the app reports on its UA two separate decisions.
    const script = readFileSync(join(repoRoot, IOS_SHELL.dir, 'scripts/build-ipa.sh'), 'utf8');
    expect(script, 'the build must read the version through the shared reader').toContain(
      'node "$REPO/release/ios-version.mjs"',
    );
    expect(script, 'the bundle version must be written from that value').toContain(
      'plutil -replace CFBundleShortVersionString -string "$VERSION"',
    );
    expect(script, 'the build must not take the version from a flag').not.toContain('kabmoVersionName');
  });

  test('the IPA workflow names the asset from that file, not from the release tag', () => {
    // The console reads the published version out of the asset NAME, so a name
    // carrying the app's tag would compare a server version against the version the
    // shell reports.
    const workflow = readFileSync(join(repoRoot, '.github/workflows/publish-ios.yml'), 'utf8');

    // The file is read through `release/ios-version.mjs` (which is `readVersionName`
    // over `packages/ios/version.properties`) rather than named here — the workflow
    // must not carry its own idea of where the number lives.
    expect(workflow).toContain('release/ios-version.mjs');
    // The name is built from the value `release/ios-version.mjs` printed, which is
    // what makes it the SAME number the bundle declares and the shell reports.
    expect(workflow, 'the asset name must come from the shell version').toContain(
      'kabmo-ios-v${VERSION}.ipa',
    );
    expect(workflow, 'the IPA must not be built with the release tag as its version').not.toContain(
      'kabmoVersionName',
    );
  });

  test('the IPA workflow reads the version through the tested reader, never through sed', () => {
    // The Android twin's first cut read it inline with `sed -n`, which with no FILE
    // argument consumes STDIN — so the second stage read nothing and the version came
    // out empty. Every read goes through `release/ios-version.mjs`, which is
    // `readVersionName`.
    const workflow = readFileSync(join(repoRoot, '.github/workflows/publish-ios.yml'), 'utf8');

    expect(workflow, 'every version read must use the shared reader').toContain(
      'node release/ios-version.mjs',
    );
    expect(workflow, 'the workflow must not parse version.properties with sed').not.toMatch(
      /sed[^\n]*version\.properties/,
    );
  });

  test('the shell and the console agree about the token and the asset name', () => {
    // Three files state the same two strings: the Swift token prefix, the TypeScript
    // parser, and the asset naming in the probe. A change to one alone makes the
    // console read this shell as a browser, or look for an asset nothing produces.
    const swift = readFileSync(join(repoRoot, IOS_SHELL.dir, 'Sources/KabmoShell/ShellUserAgent.swift'), 'utf8');
    expect(swift, 'the Swift token prefix').toContain('public static let prefix = "KabmoIOS/"');

    const ts = readFileSync(join(repoRoot, 'src/shared/lib/updates/shell-ua.ts'), 'utf8');
    expect(ts, 'the TypeScript parser must know the same prefix').toContain("ios: 'KabmoIOS/'");

    const probe = readFileSync(join(repoRoot, 'src/server/lib/updates/shell-release.ts'), 'utf8');
    expect(probe, 'the asset prefix must match the workflow').toContain("ios: { prefix: 'kabmo-ios-', extension: '.ipa' }");
  });
});

describe('reading and rewriting the version line', () => {
  test('the CLI prints the version and nothing else', () => {
    // The build script captures this with `$( … )`, so a trailing newline or any
    // other output would land INSIDE the version string and make the bundle's version
    // wrong. Run as a real process for that reason.
    const dir = mkdtempSync(join(tmpdir(), 'kabmo-ios-cli-'));
    scratch.push(dir);
    const file = join(dir, 'version.properties');
    writeFileSync(file, properties('1.2.3'));

    const result = spawnSync(process.execPath, [join(repoRoot, 'release/ios-version.mjs'), '--file', file], {
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('1.2.3');
  });

  test('the CLI exits 1 and says why when the file declares no version', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kabmo-ios-cli-'));
    scratch.push(dir);
    const file = join(dir, 'version.properties');
    writeFileSync(file, '# dropped\n');

    const result = spawnSync(process.execPath, [join(repoRoot, 'release/ios-version.mjs'), '--file', file], {
      encoding: 'utf8',
    });

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
    const text = properties('0.1.0');
    const out = replaceVersionLine(text, '0.1.0', '0.1.1');

    expect(out).toContain('versionName=0.1.1');
    expect(out).toContain('# shell version');
    expect(readVersionName(out)).toBe('0.1.1');
    // The newline must survive: a `\s*$` anchor swallows it, and the bump would then
    // be the only line in the file with no terminator.
    expect(out.endsWith('\n')).toBe(true);
    expect(out.split('\n').length).toBe(text.split('\n').length);
  });

  test('refuses to write when the expected version is not there', () => {
    expect(() => replaceVersionLine(properties('0.1.0'), '9.9.9', '9.9.10')).toThrow(/rewrote 0/);
  });

  test('keeps a hand-aligned separator, and does not match a longer key', () => {
    const aligned = '# shell version\nversionName = 0.1.0\n';
    expect(replaceVersionLine(aligned, '0.1.0', '0.1.1')).toBe('# shell version\nversionName = 0.1.1\n');

    // `minVersionName=` must not be rewritten: an anchored prefix would match it and
    // the bump would land on a line nothing reads.
    expect(() => replaceVersionLine('minVersionName=0.1.0\n', '0.1.0', '0.1.1')).toThrow(/rewrote 0/);
  });
});

describe('the version watermark', () => {
  test('is the commit that wrote the version, not the newest commit in the directory', () => {
    const dir = makeRepo();
    const add = git(dir, 'log', '-1', '--format=%H').trim();

    writeFileSync(join(dir, IOS_SHELL.dir, 'Shell.swift'), 'let a = 2\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'fix(ios): tweak the shell');

    expect(versionWatermark(dir)).toBe(add);
  });

  test('moves to the bump commit once the version is rewritten', () => {
    const dir = makeRepo();
    writeFileSync(join(dir, IOS_SHELL.dir, 'Shell.swift'), 'let a = 2\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'fix(ios): tweak the shell');

    writeFileSync(join(dir, IOS_SHELL.versionFile), properties('0.1.1'));
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'chore(release): bump the ios shell (0.1.1)');
    const bump = git(dir, 'log', '-1', '--format=%H').trim();

    expect(versionWatermark(dir)).toBe(bump);
  });

  test('reports null for a file with no version line', () => {
    const dir = makeRepo();
    writeFileSync(join(dir, IOS_SHELL.versionFile), '# dropped\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'chore(ios): drop the version');

    expect(versionWatermark(dir)).toBeNull();
  });
});

describe('the commit range', () => {
  test('is empty right after the version was written', () => {
    expect(commitsSinceWatermark(makeRepo())).toEqual([]);
  });

  test('is exactly the commits since the version was written, newest first', () => {
    const dir = makeRepo();

    writeFileSync(join(dir, IOS_SHELL.dir, 'Shell.swift'), 'let a = 2\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'fix(ios): first');
    writeFileSync(join(dir, IOS_SHELL.dir, 'Shell.swift'), 'let a = 3\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'feat(ios): second');

    expect(commitsSinceWatermark(dir).map((commit) => commit.message.split('\n')[0])).toEqual([
      'feat(ios): second',
      'fix(ios): first',
    ]);
  });

  test('ignores commits outside the shell directory, and does not re-release the bump itself', () => {
    const dir = makeRepo();

    writeFileSync(join(dir, 'README.md'), 'hello\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'docs: root readme');

    expect(commitsSinceWatermark(dir)).toEqual([]);

    // A bump commit touches version.properties, which is INSIDE the directory — it
    // must still not appear in the next range, or every release would re-bump on the
    // previous one's commit.
    writeFileSync(join(dir, IOS_SHELL.versionFile), properties('0.1.1'));
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'chore(release): bump the ios shell (0.1.1)');

    expect(commitsSinceWatermark(dir)).toEqual([]);
  });

  test('a change to the shell asks for a bump, and the two shells range independently', () => {
    // The two directories are separate artifacts on separate tracks, so a commit
    // touching only one must not bump the other — the shape a shared table would get
    // wrong.
    const dir = makeRepo();
    mkdirSync(join(dir, 'packages/android'), { recursive: true });
    writeFileSync(join(dir, 'packages/android/version.properties'), properties('0.5.0'));

    writeFileSync(join(dir, IOS_SHELL.dir, 'Shell.swift'), 'let a = 4\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'fix(ios): only the ios shell');

    expect(commitsSinceWatermark(dir).map((commit) => commit.message.split('\n')[0])).toEqual([
      'fix(ios): only the ios shell',
    ]);
  });
});
