/**
 * The macOS shell's release identity, asserted.
 *
 * The `.app` is not published anywhere, so the version it declares is the whole
 * delivery mechanism — and the failure it can cause is silent: a bundle whose
 * `CFBundleShortVersionString` does not match `version.properties` tells a user
 * they are running a different build than the one they downloaded, and an asset
 * named from anywhere but that file makes the release page lie about what it
 * carries.
 *
 * Unlike its Android and iOS siblings there is no User-Agent token, and the
 * absence is asserted here: those two are DOWNLOADED from the console, which
 * parses the running shell's version on every request. A macOS app is installed
 * by a person from the release page, so a token would be a channel with no reader
 * — and a test that only checked the presence of a token would have forced one to
 * be added.
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
  MACOS_SHELL,
  commitsSinceWatermark,
  readVersionName,
  replaceVersionLine,
  versionWatermark,
} from './macos.js';
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

/** A throwaway repository with one commit, and a version file in it. */
function scratchRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'kabmo-macos-release-'));
  scratch.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  mkdirSync(join(dir, 'packages/macos'), { recursive: true });
  writeFileSync(
    join(dir, MACOS_SHELL.versionFile),
    '# a comment\nversionName=0.1.0\n',
  );
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'chore: seed');
  return dir;
}

describe('the table matches the tree', () => {
  test('the version file exists and declares a version', () => {
    const source = readFileSync(join(repoRoot, MACOS_SHELL.versionFile), 'utf8');
    expect(readVersionName(source)).toMatch(/^\d+\.\d+\.\d+$/);
  });

  /**
   * The build reads this file through `release/macos-version.mjs`, and the plist
   * is filled from THAT. If the key or the pattern drifted, the bundle would
   * declare whatever the placeholder fell back to.
   */
  test('the build script fills the plist from this file', () => {
    const script = readFileSync(join(repoRoot, 'packages/macos/scripts/build-app.sh'), 'utf8');
    expect(script).toContain('release/macos-version.mjs');
    expect(script).toContain('CFBundleShortVersionString');
    expect(script).toContain('CFBundleVersion');
  });

  /**
   * The app is called Kabmo in every place a person sees it. A release whose
   * bundle is named after the SwiftPM target would put `kabmo-desktop` in the
   * menu bar, the Dock and Force Quit.
   */
  test('the bundle is named Kabmo', () => {
    const script = readFileSync(join(repoRoot, 'packages/macos/scripts/build-app.sh'), 'utf8');
    expect(script).toContain('<key>CFBundleName</key><string>Kabmo</string>');
    expect(script).toContain('<key>CFBundleExecutable</key><string>Kabmo</string>');
    expect(script).toContain('Kabmo.app');
  });

  /** The publish body builds from the bump and names the asset from the same file. */
  test('the publish workflow names the asset from this version', () => {
    const body = readFileSync(join(repoRoot, '.github/workflows/publish-macos.yml'), 'utf8');
    expect(body).toContain('release/macos-version.mjs');
    expect(body).toContain('kabmo-macos-v${version}.zip');
    // The version the bundle declares is verified, not assumed.
    expect(body).toContain('CFBundleShortVersionString');
    expect(body).toContain('CFBundleName');
  });

  /**
   * No User-Agent token, and that is a decision rather than an omission: the
   * console never offers this app, so nothing parses a version off a request.
   */
  test('the macOS shell reports no User-Agent token', () => {
    const ua = readFileSync(join(repoRoot, 'src/shared/lib/updates/shell-ua.ts'), 'utf8');
    expect(ua).not.toContain('KabmoMacOS');
    expect(ua).not.toContain('KabmoMac');
  });
});

describe('readVersionName', () => {
  test('reads the declared value and skips comments', () => {
    expect(readVersionName('# note\nversionName=1.2.3\n')).toBe('1.2.3');
    expect(readVersionName('versionName = 4.5.6\n')).toBe('4.5.6');
  });

  test('a missing or empty line reads as null', () => {
    expect(readVersionName('# versionName=1.0.0\n')).toBeNull();
    expect(readVersionName('versionName=\n')).toBeNull();
    expect(readVersionName('')).toBeNull();
  });
});

describe('replaceVersionLine', () => {
  test('rewrites the line and nothing else', () => {
    const before = '# a comment\nversionName=0.1.0\n# trailing\n';
    expect(replaceVersionLine(before, '0.1.0', '0.2.0')).toBe(
      '# a comment\nversionName=0.2.0\n# trailing\n',
    );
  });

  test('keeps hand-written spacing', () => {
    expect(replaceVersionLine('versionName = 1.0.0\n', '1.0.0', '1.0.1')).toBe(
      'versionName = 1.0.1\n',
    );
  });

  /**
   * A partial rewrite is refused rather than written: the file is the only place
   * the version is declared, so half a bump is worse than none.
   */
  test('refuses when the previous value does not match', () => {
    expect(() => replaceVersionLine('versionName=9.9.9\n', '1.0.0', '1.0.1')).toThrow(
      'refusing to write a partial bump',
    );
  });
});

describe('the commit range', () => {
  test('the watermark is the commit that wrote the version line', () => {
    const dir = scratchRepo();
    const seed = git(dir, 'rev-parse', 'HEAD').trim();
    expect(versionWatermark(dir)).toBe(seed);
  });

  test('a commit that does not touch the file is in range, and a bump is not', () => {
    const dir = scratchRepo();
    // The range is limited to `packages/macos`, so the commit has to touch it —
    // a README at the repository root is deliberately outside the range.
    writeFileSync(join(dir, 'packages/macos/README.md'), 'hello\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'feat: something else');

    expect(commitsSinceWatermark(dir).length).toBe(1);

    // Writing the version MOVES the watermark, so the bump itself is never in
    // its own range — which is what stops the next run from bumping again.
    const source = readFileSync(join(dir, MACOS_SHELL.versionFile), 'utf8');
    writeFileSync(join(dir, MACOS_SHELL.versionFile), replaceVersionLine(source, '0.1.0', '0.2.0'));
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'chore(release): bump the macos shell (0.2.0)');

    expect(commitsSinceWatermark(dir).length).toBe(0);
    expect(readVersionName(readFileSync(join(dir, MACOS_SHELL.versionFile), 'utf8'))).toBe('0.2.0');
  });
});
