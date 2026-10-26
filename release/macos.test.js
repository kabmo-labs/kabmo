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
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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

  /** The publish body builds from the bump and names the assets from the same file. */
  test('the publish workflow names the asset from this version', () => {
    const body = readFileSync(join(repoRoot, '.github/workflows/publish-macos.yml'), 'utf8');
    expect(body).toContain('release/macos-version.mjs');
    // `<App>-<version>-<platform>-<arch>.<ext>`: the architecture is part of the
    // name, or the two builds of one release collide as a single release asset.
    // The base is built once and both shapes hang off it, so the `.zip` and the
    // `.dmg` cannot disagree about which build they are.
    expect(body).toContain('base="Kabmo-${version}-mac-${ARCH}"');
    expect(body, 'the zip is what a script consumes').toContain('"${base}.zip"');
    expect(body, 'the dmg is what a person downloads').toContain('"${base}.dmg"');
    // The version the bundle declares is verified, not assumed.
    expect(body).toContain('CFBundleShortVersionString');
    expect(body).toContain('CFBundleName');
  });

  /**
   * Both SHAPES ship, and the `.dmg` is a real disk image with an Applications
   * alias — not a renamed zip.
   *
   * The alias is the whole point of a DMG: without it a first-time user opens the
   * window and has no idea where the app is supposed to go.
   */
  test('the publish workflow ships a dmg with an Applications alias', () => {
    const body = readFileSync(join(repoRoot, '.github/workflows/publish-macos.yml'), 'utf8');
    expect(body, 'the dmg must be made with hdiutil, which ships with macOS').toContain(
      'hdiutil create',
    );
    expect(body, 'the dmg must be compressed read-only').toContain('-format UDZO');
    expect(body, 'the dmg must carry an Applications alias').toContain(
      'ln -s /Applications',
    );
    // An empty image is what a wrong source folder produces, and `hdiutil` still
    // exits 0 — so the artifact is checked rather than trusted.
    expect(body, 'both shapes must be verified non-empty').toMatch(
      /for f in "\$\{base\}\.zip" "\$\{base\}\.dmg"; do/,
    );
  });

  /**
   * Both architectures are built, on the runners that ARE those architectures.
   *
   * A single-arch body would still publish successfully — it would just hand an
   * Intel Mac an app it cannot launch. The matrix is the assertion, and the
   * Mach-O check is what makes it a fact about the artifact rather than about the
   * runner's label.
   */
  test('the publish workflow builds both architectures natively', () => {
    const doc = Bun.YAML.parse(
      readFileSync(join(repoRoot, '.github/workflows/publish-macos.yml'), 'utf8'),
    );
    const rows = doc.jobs.build.strategy.matrix.include;
    expect(rows.map((row) => row.arch)).toEqual(['arm64', 'x64']);
    // The image IS the architecture: `macos-15` is Apple silicon, `macos-15-intel`
    // is Intel. A shared runner label would cross-compile, which the Mach-O
    // assertion in the body would then fail.
    expect(rows.find((row) => row.arch === 'arm64')?.runner).toBe('macos-15');
    expect(rows.find((row) => row.arch === 'x64')?.runner).toBe('macos-15-intel');
    // `lipo` prints the Mach-O spelling, which differs from the asset's for Intel.
    expect(rows.find((row) => row.arch === 'x64')?.macho).toBe('x86_64');

    const text = JSON.stringify(doc.jobs.build.steps);
    expect(text, 'the artifact must be checked against its own Mach-O header').toContain('lipo -archs');
    expect(text, 'one artifact per architecture, or the second row overwrites the first').toContain(
      'kabmo-macos-app-${{ matrix.arch }}',
    );
    expect(
      JSON.stringify(doc.jobs.attach.steps),
      'the attach must merge both architecture artifacts back',
    ).toContain('merge-multiple');
  });

  /**
   * The app target must not contain a file named `main.swift`, and this is a
   * Swift rule rather than a style choice.
   *
   * A file with that exact name is compiled as TOP-LEVEL CODE, and `@main` is
   * rejected in a module that contains any: "error: 'main' attribute cannot be
   * used in a module that contains top-level code". The build failed that way on
   * the release runner (Swift 6.1.2) while a newer local toolchain (6.4)
   * accepted it — which is precisely why a source-layout assertion belongs here
   * rather than a note in the file that the next rename can undo.
   */
  test('the app target has no main.swift, so @main is legal', () => {
    const sources = join(repoRoot, 'packages/macos/Sources/kabmo-desktop');
    const names = readdirSync(sources);
    expect(names).not.toContain('main.swift');
    expect(names).toContain('App.swift');
    // And `@main` must actually be there: a rename that dropped the entry point
    // would leave a package that builds nothing runnable.
    expect(readFileSync(join(sources, 'App.swift'), 'utf8')).toContain('@main');
  });

  /**
   * No User-Agent token, and that is a decision rather than an omission.
   *
   * The console DOES offer this app an update now, but it learns the installed
   * version over the BRIDGE (`__kabmoDesktop.shellVersion`), not the UA: a
   * desktop app carries no `KabmoMacOS/` token, and adding one would mean every
   * asset request carried it for a string the bridge already supplies before the
   * first paint.
   */
  test('the macOS shell reports no User-Agent token', () => {
    const ua = readFileSync(join(repoRoot, 'src/shared/lib/updates/shell-ua.ts'), 'utf8');
    expect(ua).not.toContain('KabmoMacOS');
    expect(ua).not.toContain('KabmoMac');
  });

  /**
   * The version the shell REPORTS must be the bundle's, not a literal.
   *
   * `App.swift` used to declare `shellVersion: "0.1.0"`, which is a second number
   * for one build: the release pipeline bumped `version.properties` to `0.2.0`
   * while the running app went on telling the console `0.1.0`, so the console
   * compared a published artifact against a version that did not exist.
   */
  test('the reported version comes from the bundle', () => {
    const app = readFileSync(join(repoRoot, MACOS_SHELL.dir, 'Sources/kabmo-desktop/App.swift'), 'utf8');
    expect(app, 'the shell must read its version').toContain('ShellVersion.current()');
    expect(app, 'a literal version is the drift this prevents').not.toMatch(/shellVersion: "\d+\.\d+\.\d+"/);

    const reader = readFileSync(
      join(repoRoot, MACOS_SHELL.dir, 'Sources/KabmoDesktop/ShellVersion.swift'),
      'utf8',
    );
    expect(reader, 'the plist key macOS reads').toContain('CFBundleShortVersionString');
  });

  /**
   * Settings › asks the PAGE, and never reloads it.
   *
   * The row appended `?settings=1` and loaded the URL again, which no client code
   * reads: the live document went away — a running turn, the composer draft, the
   * timeline's scroll position — and no settings screen appeared. The console
   * listens for `omp:open-settings` in both layouts, so the row must dispatch it.
   *
   * Asserted on the source because the wrong shape is invisible: a reload looks
   * like a working menu item, and the modal simply never opens. The event itself
   * is pinned by the window suite, which dispatches the shipped script into a
   * real page.
   */
  test('the Settings row opens the console modal instead of reloading', () => {
    const app = readFileSync(join(repoRoot, MACOS_SHELL.dir, 'Sources/kabmo-desktop/App.swift'), 'utf8');
    expect(app, 'the row must go through the page-event helper').toContain('openSettings(in: webView)');
    expect(app, 'a query parameter nothing reads is the bug this replaces').not.toContain(
      'URLQueryItem(name: "settings"',
    );

    const events = readFileSync(
      join(repoRoot, MACOS_SHELL.dir, 'Sources/KabmoDesktop/PageEvents.swift'),
      'utf8',
    );
    // The name is stated once in Swift and once in the client, and a typo in
    // either is silent: the shell dispatches into the void and the modal never
    // opens. The literal is read out of BOTH sides rather than compared to a
    // string this test wrote, which would pass with the two disagreeing.
    const declared = events.match(/openSettingsEvent\s*=\s*"([^"]+)"/)?.[1];
    expect(declared, 'the shell must declare the event name as one constant').toBeTruthy();

    const client = readFileSync(
      join(repoRoot, 'src/client/components/settings/Modal.tsx'),
      'utf8',
    );
    expect(client, 'the console must listen for the name the shell sends').toContain(
      `'${declared}'`,
    );
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
