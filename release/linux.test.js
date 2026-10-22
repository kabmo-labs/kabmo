/**
 * The Linux shell's release identity, asserted.
 *
 * The app is not published anywhere, so the version it declares is the whole
 * delivery mechanism — and the failure it can cause is silent in a way nothing
 * else in this repository is. Two readers depend on the number moving:
 *
 * - `build.rs` bakes it into the binary as `KABMO_SHELL_VERSION`, which is what the
 *   app reports to the page as `shellVersion`. A release whose number did not move
 *   is indistinguishable from the previous one.
 * - `publish-linux.yml` names the asset from the same file, so a name taken from
 *   anywhere else would describe a build nobody can identify.
 *
 * Unlike the two mobile shells there is no console download and no User-Agent
 * token: a desktop app is installed by hand from the release page, so nothing
 * offers it and nothing parses it. This file asserts that absence
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
  LINUX_SHELL,
  commitsSinceWatermark,
  readVersionName,
  replaceVersionLine,
  versionWatermark,
} from './linux.js';
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
  const dir = mkdtempSync(join(tmpdir(), 'kabmo-linux-release-'));
  scratch.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.invalid');
  git(dir, 'config', 'user.name', 'Test');

  mkdirSync(join(dir, LINUX_SHELL.dir, 'src'), { recursive: true });
  writeFileSync(join(dir, LINUX_SHELL.versionFile), properties('0.1.0'));
  writeFileSync(join(dir, LINUX_SHELL.dir, 'src/store.rs'), 'fn main() {}\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'feat(linux): add the shell');

  return dir;
}

describe('the shell version is one declared fact', () => {
  test('version.properties exists, is a three-part version, and is what the build reads', () => {
    const text = readFileSync(join(repoRoot, LINUX_SHELL.versionFile), 'utf8');
    const version = readVersionName(text);

    expect(version, `${LINUX_SHELL.versionFile} declares no versionName`).not.toBeNull();
    expect(version, 'the shell version must be a three-part version').toMatch(/^\d+\.\d+\.\d+$/);

    // The BUILD must take the version from the file. A literal in the source, or
    // `CARGO_PKG_VERSION`, would make the number the pipeline publishes and the
    // number the app reports two separate decisions.
    const build = readFileSync(join(repoRoot, LINUX_SHELL.dir, 'build.rs'), 'utf8');
    expect(build, 'the build must read version.properties').toContain('version.properties');
    expect(build, 'the build must fail when the file declares nothing').toContain('declares no versionName');
    expect(build, 'the version must reach the binary through the environment').toContain(
      'cargo:rustc-env=KABMO_SHELL_VERSION',
    );

    // And the bridge must REPORT it, never a literal or the crate's own version.
    const bridge = readFileSync(join(repoRoot, LINUX_SHELL.dir, 'src/bridge.rs'), 'utf8');
    expect(bridge, 'shellVersion must come from build.rs').toContain('env!("KABMO_SHELL_VERSION")');
    expect(bridge, 'shellVersion must not come from the crate version').not.toContain(
      'env!("CARGO_PKG_VERSION")',
    );
  });

  test('the app is called Kabmo on every surface a user can see', () => {
    // Four independent things state the name and each fails silently on its own:
    // the window title, the process name / `WM_CLASS` (what the window manager
    // labels the taskbar entry), the About panel, and the launcher entry. The
    // binary is named after the APP for the middle one — GTK derives the process
    // name from the executable's file name, which is exactly how `kabmo-desktop`
    // ended up in the window list on a shell whose title said Kabmo.
    const name = readFileSync(join(repoRoot, LINUX_SHELL.dir, 'src/lib.rs'), 'utf8');
    expect(name, 'the app name must be stated once').toContain('pub const APP_NAME: &str = "Kabmo";');

    const main = readFileSync(join(repoRoot, LINUX_SHELL.dir, 'src/main.rs'), 'utf8');
    expect(main, 'the process name must be the app name').toContain(
      'gtk::glib::set_prgname(Some(APP_NAME))',
    );
    expect(main, 'the application name must be the app name').toContain(
      'gtk::glib::set_application_name(APP_NAME)',
    );

    const cargo = readFileSync(join(repoRoot, LINUX_SHELL.dir, 'Cargo.toml'), 'utf8');
    expect(cargo, 'the binary must be named Kabmo').toMatch(/\[\[bin\]\]\nname = "Kabmo"/);

    // The launcher entry is a TEMPLATE the installer fills in — an `Exec` must be
    // an absolute path and a tarball unpacks anywhere, so only the installer knows
    // where the binary landed.
    const template = readFileSync(
      join(repoRoot, LINUX_SHELL.dir, 'scripts/kabmo.desktop.in'),
      'utf8',
    );
    expect(template, 'the launcher entry must be named Kabmo').toContain('\nName=Kabmo\n');
    expect(template, 'StartupWMClass must be the WM_CLASS the app actually reports').toContain(
      '\nStartupWMClass=Kabmo\n',
    );
    expect(template, 'the entry must take its Exec from the installer').toContain('Exec=@EXEC@');

    const workflow = readFileSync(join(repoRoot, '.github/workflows/publish-linux.yml'), 'utf8');
    expect(workflow, 'the workflow must run the binary the bundle ships').toContain(
      '"$out/Kabmo" --version',
    );
  });

  test('the publish workflow names the asset from that file, not from the release tag', () => {
    const workflow = readFileSync(join(repoRoot, '.github/workflows/publish-linux.yml'), 'utf8');

    // The file is read through `release/linux-version.mjs` rather than named here —
    // the workflow must not carry its own idea of where the number lives.
    expect(workflow).toContain('release/linux-version.mjs');
    expect(workflow, 'the asset name must come from the shell version').toContain(
      'kabmo-linux-v${VERSION}.tar.gz',
    );
    // Anchored on the COMMAND (`sed -n …` / `sed 's/…'`), not on the word: the
    // workflow's own prose says "a missing or unparsed `version.properties`", which
    // a looser pattern reads as an inline parse.
    expect(workflow, 'the workflow must not parse version.properties with sed').not.toMatch(
      /\bsed\s+[^\n]*version\.properties/,
    );
  });

  test('the packaged artifact carries the version the binary reports', () => {
    // The binary reports `KABMO_SHELL_VERSION` (from `build.rs`), and the workflow
    // verifies the built binary carries the declared number before naming the
    // archive. A packaging script with its own reader would be a second answer.
    const script = readFileSync(join(repoRoot, LINUX_SHELL.dir, 'scripts/build-app.sh'), 'utf8');
    // Anchored on the COMMAND, not the word: the script's own comment names the
    // reader it deliberately does not call, and a looser pattern reads that prose as
    // an invocation.
    expect(script, 'the packaging must not read the version itself').not.toMatch(
      /\bnode\s+[^\n]*linux-version\.mjs/,
    );

    const workflow = readFileSync(join(repoRoot, '.github/workflows/publish-linux.yml'), 'utf8');
    expect(workflow, 'the workflow must verify the built binary').toContain(
      'the binary reports',
    );
    // The flag it verifies through must exist: a workflow that runs `--version`
    // against a shell that ignores it reads the usage text and reports a mismatch.
    const main = readFileSync(join(repoRoot, LINUX_SHELL.dir, 'src/main.rs'), 'utf8');
    expect(main, 'the binary must answer --version before GTK starts').toContain('"--version"');
  });

  test('the installer is a real installer, not a heredoc in the packaging script', () => {
    // A `.desktop` shipped ready-made CANNOT work: `Exec` takes an absolute path
    // and a tarball unpacks wherever the user put it. The first version dodged
    // that with `Exec=sh -c 'exec "$(dirname "$1")/Kabmo"' sh %k`, and
    // `desktop-file-validate` rejects it — the spec has no single quotes, and `$`
    // must be escaped inside a quoted argument. An invalid entry fails SILENTLY:
    // the launcher lists the app and clicking it does nothing.
    const dir = join(repoRoot, LINUX_SHELL.dir, 'scripts');
    const installer = readFileSync(join(dir, 'install.sh'), 'utf8');
    const template = readFileSync(join(dir, 'kabmo.desktop.in'), 'utf8');
    const packaging = readFileSync(join(dir, 'build-app.sh'), 'utf8');

    // The installer is its own file and the packaging script COPIES it. A heredoc
    // inside `build-app.sh` is a second program nothing can run on its own, and it
    // is what the previous version did.
    expect(installer, 'the installer must install the binary').toContain('install -m 755');
    expect(installer, 'the installer must fill the template').toContain('kabmo.desktop.in');
    expect(installer, 'the installer must validate the entry it wrote').toContain(
      'desktop-file-validate',
    );
    expect(installer, 'the installer must support removal').toContain('--uninstall');
    expect(packaging, 'the packaging must ship the installer, not generate it').toContain(
      'cp "$HERE/scripts/install.sh"',
    );
    expect(packaging, 'the packaging must not write an entry itself').not.toContain(
      "cat > \"$OUT/kabmo.desktop\"",
    );

    // The template carries no `sh -c` and no single quote: both are what the
    // validator rejected.
    expect(template, 'the template must not use a shell wrapper').not.toContain('sh -c');
    expect(template, 'the template must not contain a single quote').not.toContain("'");

    // The installer QUOTES the Exec argument. `desktop-file-validate` accepts an
    // unquoted path with a space (measured), while a launcher splits it into two
    // arguments and starts nothing — so the quote is asserted on the helper.
    expect(installer, 'a path with a space must stay one argument').toContain('exec_argument');
    expect(installer, 'the placeholder check must fail the install').toContain(
      'unresolved placeholders',
    );
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
    expect(probe, 'the asset table must not grow a linux row').not.toContain("linux: { prefix:");
  });

  test('the release chain bumps, builds, and only then tags', () => {
    // The ordering is what makes a bump reach an installed app at all: the bump
    // commits the version into `main`, `linux-build` packages from `main`, and `app`
    // fast-forwards onto both before it tags. A bump landing after the pack would
    // ship the previous version — an artifact nobody can tell from the last one.
    const release = readFileSync(join(repoRoot, '.github/workflows/release.yml'), 'utf8');
    expect(release, 'release.yml must run the linux bump').toContain('node release/release-linux.mjs');
    expect(release, 'release.yml must commit the linux bump').toContain(
      'git add packages/linux/version.properties',
    );
    expect(release, 'release.yml must call the linux body').toContain(
      './.github/workflows/publish-linux.yml',
    );
  });
});

describe('reading and rewriting the version line', () => {
  test('the CLI prints the version and nothing else', () => {
    // The workflow captures this with `$( … )`, so a trailing newline or any other
    // output would land INSIDE the version string.
    const dir = mkdtempSync(join(tmpdir(), 'kabmo-linux-cli-'));
    scratch.push(dir);
    const file = join(dir, 'version.properties');
    writeFileSync(file, properties('1.2.3'));

    const result = spawnSync(process.execPath, [join(repoRoot, 'release/linux-version.mjs'), '--file', file], {
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('1.2.3');
  });

  test('the CLI exits 1 and says why when the file declares no version', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kabmo-linux-cli-'));
    scratch.push(dir);
    const file = join(dir, 'version.properties');
    writeFileSync(file, '# dropped\n');

    const result = spawnSync(process.execPath, [join(repoRoot, 'release/linux-version.mjs'), '--file', file], {
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
    writeFileSync(join(dir, LINUX_SHELL.versionFile), properties('0.1.1'));
    git(dir, 'commit', '-q', '-am', 'chore(release): bump the linux shell (0.1.1)');
    // …and everything after it is pending.
    writeFileSync(join(dir, LINUX_SHELL.dir, 'src/store.rs'), 'class A { int x; }\n');
    git(dir, 'commit', '-q', '-am', 'fix(linux): make the window movable');

    const commits = commitsSinceWatermark(dir);
    expect(commits.map((commit) => commit.message)).toEqual(['fix(linux): make the window movable']);
  });

  test('ignores commits outside the shell directory', () => {
    const dir = makeRepo();
    writeFileSync(join(dir, LINUX_SHELL.versionFile), properties('0.1.1'));
    git(dir, 'commit', '-q', '-am', 'chore(release): bump the linux shell (0.1.1)');
    // A server-only change must not bump a shell that did not change — the number
    // moving without the shell moving is an update no installed app can use.
    writeFileSync(join(dir, 'README.md'), '# app\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'feat(app): something else entirely');

    expect(commitsSinceWatermark(dir)).toEqual([]);
  });
});
