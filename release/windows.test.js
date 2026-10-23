/**
 * The Windows shell's release identity, asserted.
 *
 * The app is not published anywhere, so the version it declares is the whole
 * delivery mechanism — and the failure it can cause is silent in a way nothing
 * else in this repository is. Two readers depend on the number moving:
 *
 * - the csproj bakes it into the assembly, which is what the app shows a user and
 *   reports to the page as `shellVersion`. A release whose number did not move is
 *   indistinguishable from the previous one.
 * - `publish-windows.yml` names the asset from the same file, so a name taken from
 *   anywhere else would describe a build nobody can identify.
 *
 * Unlike the two mobile shells there is no console download and no User-Agent
 * token: a desktop app is installed by hand from the release page, so nothing
 * offers it and nothing parses it. `release/windows.test.js` asserts that absence
 * as well, because "add a token like Android's" is the obvious wrong next step.
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
  WINDOWS_SHELL,
  commitsSinceWatermark,
  readVersionName,
  replaceVersionLine,
  versionWatermark,
} from './windows.js';
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
  const dir = mkdtempSync(join(tmpdir(), 'kabmo-windows-release-'));
  scratch.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.invalid');
  git(dir, 'config', 'user.name', 'Test');

  mkdirSync(join(dir, WINDOWS_SHELL.dir), { recursive: true });
  writeFileSync(join(dir, WINDOWS_SHELL.versionFile), properties('0.1.0'));
  writeFileSync(join(dir, WINDOWS_SHELL.dir, 'Shell.cs'), 'class A {}\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'feat(windows): add the shell');

  return dir;
}

describe('the shell version is one declared fact', () => {
  test('version.properties exists, is a three-part version, and is what the build reads', () => {
    const text = readFileSync(join(repoRoot, WINDOWS_SHELL.versionFile), 'utf8');
    const version = readVersionName(text);

    expect(version, `${WINDOWS_SHELL.versionFile} declares no versionName`).not.toBeNull();
    expect(version, 'the shell version must be a three-part version').toMatch(/^\d+\.\d+\.\d+$/);

    // The BUILD must take the version from the file. A `-p:Version` argument would
    // make the number the pipeline publishes and the number the app reports two
    // separate decisions.
    const project = readFileSync(
      join(repoRoot, WINDOWS_SHELL.dir, 'src/KabmoDesktop.App/KabmoDesktop.App.csproj'),
      'utf8',
    );
    expect(project, 'the build must read version.properties').toContain('version.properties');
    expect(project, 'the build must fail when the file declares nothing').toContain('declares no versionName');
    // A literal here is the drift this whole file exists to prevent.
    expect(project, 'the project must not state a version of its own').not.toMatch(/<Version>\d/);
  });

  test('the publish workflow names the asset from that file, not from the release tag', () => {
    const workflow = readFileSync(join(repoRoot, '.github/workflows/publish-windows.yml'), 'utf8');

    // The file is read through `release/windows-version.mjs` rather than named here —
    // the workflow must not carry its own idea of where the number lives.
    expect(workflow).toContain('release/windows-version.mjs');
    // The ASSET is the installer, named from the version file. `OutputBaseFilename`
    // in the `.iss` is what actually produces it, so both sides are asserted.
    expect(workflow, 'the asset name must come from the shell version').toContain(
      'Kabmo-$env:VERSION-win-$env:ARCH-setup.exe',
    );
    const iss = readFileSync(join(repoRoot, WINDOWS_SHELL.dir, 'installer/kabmo.iss'), 'utf8');
    expect(iss, 'the installer must name itself from the version it is given').toContain(
      'OutputBaseFilename=Kabmo-{#AppVersion}-win-{#AppArch}-setup',
    );
    // A `-p:Version=` argument would be a second source that can disagree with the
    // asset name. The bare `-p:Version` appears in the comment that explains why it
    // is absent, so the assertion is on the command form.
    expect(workflow, 'the publish must not pass a version flag').not.toContain('-p:Version=');
    // Anchored on the COMMAND (`sed -n …` / `sed 's/…'`), not on the word: the
    // workflow's own prose says "a missing or unparsed `version.properties`", which
    // a looser pattern reads as an inline parse.
    expect(workflow, 'the workflow must not parse version.properties with sed').not.toMatch(
      /\bsed\s+[^\n]*version\.properties/,
    );
  });

  /**
   * Both architectures are built, and the installer refuses the machine it does
   * not target.
   *
   * The `.iss` gate is the half a unit test can check and a user feels: an Arm64
   * publish installed on x64 Windows succeeds and then opens a window that never
   * paints, so `ArchitecturesAllowed` has to come from the same value that named
   * the file.
   */
  test('the publish workflow builds both architectures, each on its own runner', () => {
    const doc = Bun.YAML.parse(
      readFileSync(join(repoRoot, '.github/workflows/publish-windows.yml'), 'utf8'),
    );
    const rows = doc.jobs.build.strategy.matrix.include;
    expect(rows.map((row) => row.arch)).toEqual(['x64', 'arm64']);
    expect(rows.map((row) => row.rid)).toEqual(['win-x64', 'win-arm64']);
    // The runner IS the architecture. A cross-publish would produce a binary the
    // rules suite never executed and the PE check below would then reject.
    expect(rows.find((row) => row.arch === 'x64')?.runner).toBe('windows-latest');
    expect(rows.find((row) => row.arch === 'arm64')?.runner).toBe('windows-11-arm');

    const text = JSON.stringify(doc.jobs.build.steps);
    expect(text, 'the publish must target the matrix architecture').toContain('-r $env:RID');
    // 0x8664 = x64, 0xAA64 = Arm64, read from the PE header of the built exe.
    expect(text, 'the artifact must be checked against its own PE header').toContain('EXPECTED_MACHINE');
    expect(text, 'one artifact per architecture, or the second row overwrites the first').toContain(
      'kabmo-windows-app-${{ matrix.arch }}',
    );
    expect(
      JSON.stringify(doc.jobs.attach.steps),
      'the attach must merge both architecture artifacts back',
    ).toContain('merge-multiple');

    const iss = readFileSync(join(repoRoot, WINDOWS_SHELL.dir, 'installer/kabmo.iss'), 'utf8');
    // The gate and the name come from ONE value, or an Arm64 installer could be
    // named for x64 and refuse the machine it was built for.
    expect(iss, 'the installer must gate on the target architecture').toContain(
      'ArchitecturesAllowed={#ArchAllowed}',
    );
    expect(iss, 'the installer must use 64-bit install mode on that architecture').toContain(
      'ArchitecturesInstallIn64BitMode={#ArchAllowed}',
    );
    expect(iss, 'arm64 must be its own allowed value').toContain('#define ArchAllowed "arm64"');
    // `x64compatible` would also match Arm64 Windows (x64 emulation), so the x64
    // installer would install where the native Arm64 one belongs.
    expect(iss, 'the x64 installer must not claim Arm64 machines').toContain(
      '#define ArchAllowed "x64os"',
    );
  });

  test('the app reports the version the assembly carries', () => {
    // The bridge's `shellVersion` must be the ASSEMBLY's version, never a literal in
    // the shell's source: a second copy drifts the first time either is bumped, and
    // the console would compare two unrelated numbers.
    const host = readFileSync(join(repoRoot, WINDOWS_SHELL.dir, 'src/KabmoDesktop.App/ShellHost.cs'), 'utf8');
    expect(host, 'shellVersion must come from the assembly').toContain('Assembly.GetName().Version');
  });

  test('there is no console download path for a desktop app', () => {
    // A token with no reader is a channel nothing maintains: the console serves
    // `/api/updates/{android,ios}` because a phone can be handed an install link,
    // and a desktop cannot. Adding a `windows` kind here without a surface that
    // offers it would be a route nobody calls, and the same is true of the UA.
    const kinds = readFileSync(join(repoRoot, 'src/shared/lib/updates/shell-ua.ts'), 'utf8');
    expect(kinds, 'the shell kinds are the two DOWNLOADABLE shells').toContain(
      "export type ShellKind = 'android' | 'ios';",
    );

    const probe = readFileSync(join(repoRoot, 'src/server/lib/updates/shell-release.ts'), 'utf8');
    expect(probe, 'the asset table must not grow a windows row').not.toContain("windows: { prefix:");
  });

  test('the artifact is an INSTALLER, not a ZIP', () => {
    // A ZIP leaves no Add/remove-programs entry, no Start-menu entry and no
    // uninstaller, so "which version is this" and "how do I remove it" both have no
    // answer. The four things that make it an installer rather than a renamed
    // archive are asserted individually, because each can be dropped alone:
    const workflow = readFileSync(join(repoRoot, '.github/workflows/publish-windows.yml'), 'utf8');
    const iss = readFileSync(join(repoRoot, WINDOWS_SHELL.dir, 'installer/kabmo.iss'), 'utf8');

    // 1. it is COMPILED by Inno Setup, which the runner already has;
    expect(workflow, 'the build must compile the .iss').toContain('ISCC.exe');
    expect(workflow, 'the build must fail when ISCC fails').toContain('ISCC failed');
    // 2. it registers an uninstaller and an Add/remove-programs entry;
    expect(iss, 'the installer must be uninstallable').toContain('UninstallDisplayName=');
    expect(iss, 'the installer must appear in Add/remove programs').toContain('AppPublisher=');
    // 3. it creates the Start-menu entry a ZIP cannot;
    expect(iss, 'the installer must add a Start-menu entry').toContain('Name: "{group}');
    // 4. it upgrades rather than installing a second copy — one stable AppId;
    expect(iss, 'a stable AppId is what makes an upgrade an upgrade').toMatch(/AppId=\{\{[0-9A-F-]{36}\}/);

    // And the version is never written into the script: it arrives as /DAppVersion
    // from `version.properties`, so there is one declared fact.
    expect(iss, 'the script must not carry a literal version').not.toMatch(/^AppVersion=\d/m);
    expect(workflow, 'the version must be passed on the ISCC command line').toContain(
      '"/DAppVersion=$env:VERSION"',
    );

    // The workflow must no longer ship an archive: a `Compress-Archive` here would
    // mean two artifacts, one of which nobody asked for.
    expect(workflow, 'the release must not also ship a ZIP').not.toContain('Compress-Archive');
  });

  test('the release chain bumps, builds, and only then tags', () => {
    // The ordering is what makes a bump reach an installed app at all: the bump
    // commits the version into `main`, `win-build` packages from `main`, and `app`
    // fast-forwards onto both before it tags. A bump landing after the pack would
    // ship the previous version — an artifact nobody can tell from the last one.
    const release = readFileSync(join(repoRoot, '.github/workflows/release.yml'), 'utf8');
    expect(release, 'release.yml must run the windows bump').toContain('node release/release-windows.mjs');
    expect(release, 'release.yml must commit the windows bump').toContain(
      'git add packages/windows/version.properties',
    );
    expect(release, 'release.yml must call the windows body').toContain(
      './.github/workflows/publish-windows.yml',
    );
  });
});

describe('reading and rewriting the version line', () => {
  test('the CLI prints the version and nothing else', () => {
    // The workflow captures this with `$( … )`, so a trailing newline or any other
    // output would land INSIDE the version string.
    const dir = mkdtempSync(join(tmpdir(), 'kabmo-windows-cli-'));
    scratch.push(dir);
    const file = join(dir, 'version.properties');
    writeFileSync(file, properties('1.2.3'));

    const result = spawnSync(process.execPath, [join(repoRoot, 'release/windows-version.mjs'), '--file', file], {
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('1.2.3');
  });

  test('the CLI exits 1 and says why when the file declares no version', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kabmo-windows-cli-'));
    scratch.push(dir);
    const file = join(dir, 'version.properties');
    writeFileSync(file, '# dropped\n');

    const result = spawnSync(process.execPath, [join(repoRoot, 'release/windows-version.mjs'), '--file', file], {
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
    // The newline is not swallowed by the rewrite: a file whose last line lost its
    // terminator would be the only one in the tree.
    expect(out.endsWith('\n')).toBe(true);
  });

  test('refuses to rewrite when the previous value is not the one present', () => {
    // A partial bump is worse than none: the release would carry a number the file
    // does not, and the next range would start in the wrong place.
    expect(() => replaceVersionLine(properties('0.1.0'), '0.0.9', '0.1.1')).toThrow(/rewrote 0/);
  });
});

describe('the commit range', () => {
  test('finds nothing when the watermark is the head commit', () => {
    const dir = makeRepo();
    expect(versionWatermark(dir)).toBe(git(dir, 'rev-parse', 'HEAD').trim());
    expect(commitsSinceWatermark(dir)).toEqual([]);
  });

  test('finds the commits after the version was written', () => {
    const dir = makeRepo();
    // The version write starts the range…
    writeFileSync(join(dir, WINDOWS_SHELL.versionFile), properties('0.1.1'));
    git(dir, 'commit', '-q', '-am', 'chore(release): bump the windows shell (0.1.1)');
    // …and everything after it is pending.
    writeFileSync(join(dir, WINDOWS_SHELL.dir, 'Shell.cs'), 'class A { int x; }\n');
    git(dir, 'commit', '-q', '-am', 'fix(windows): make the window movable');

    const commits = commitsSinceWatermark(dir);
    expect(commits.map((commit) => commit.message)).toEqual(['fix(windows): make the window movable']);
  });

  test('ignores commits outside the shell directory', () => {
    const dir = makeRepo();
    writeFileSync(join(dir, WINDOWS_SHELL.versionFile), properties('0.1.1'));
    git(dir, 'commit', '-q', '-am', 'chore(release): bump the windows shell (0.1.1)');
    // A server-only change must not bump a shell that did not change — the number
    // moving without the shell moving is an update no installed app can use.
    writeFileSync(join(dir, 'README.md'), '# app\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'feat(app): something else entirely');

    expect(commitsSinceWatermark(dir)).toEqual([]);
  });
});
