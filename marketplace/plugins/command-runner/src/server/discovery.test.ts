/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The parsers and the package-manager walk.
 *
 * Every case here is a shape that appears in a real file and breaks a naive
 * implementation, so each test names the shape rather than the regex:
 *
 * - a `Makefile` with `.PHONY` (a dot-target is not a command) and with a
 *   variable assignment CONTAINING a colon (`SRC := a:b`), which a bare
 *   `^(\w+):` rule lists as a command named `SRC`;
 * - a pattern rule (`%.o: %.c`), which is a rule rather than something to run;
 * - a `justfile` with `set shell := …` (an assignment) and `[attributes]`;
 * - a `package.json` whose `scripts` is absent (a valid file with no commands).
 *
 * The runner walk is tested through real directories, because the ORDER of its
 * three sources is the decision — a declared `packageManager` beats a lockfile,
 * and the nearest lockfile beats Bun.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DETECTORS, claimedFilenames, detectorFor } from '../../src/server/detectors/table';
import type { DetectorContext } from '../../src/server/detectors/types';
import type { CommandKind } from '../../src/protocol';
import { runnerForLockfile, runnerForPackageManager } from '../../src/server/package-manager';
import { resolveRunner, resolveScope, scanScope } from '../../src/server/scan';

describe('runnerForPackageManager', () => {
  test('reads the name out of a name@version field', () => {
    expect(runnerForPackageManager('bun@1.4.2')).toBe('bun');
    expect(runnerForPackageManager('pnpm@9')).toBe('pnpm');
  });

  test('accepts a bare name', () => {
    expect(runnerForPackageManager('yarn')).toBe('yarn');
  });

  test('refuses what it does not know, so the lockfile decides', () => {
    expect(runnerForPackageManager('corepack@1')).toBeNull();
    expect(runnerForPackageManager(42)).toBeNull();
    expect(runnerForPackageManager(undefined)).toBeNull();
  });
});

describe('runnerForLockfile', () => {
  test('maps each lockfile', () => {
    expect(runnerForLockfile('bun.lock')).toBe('bun');
    expect(runnerForLockfile('bun.lockb')).toBe('bun');
    expect(runnerForLockfile('package-lock.json')).toBe('npm');
    expect(runnerForLockfile('npm-shrinkwrap.json')).toBe('npm');
    expect(runnerForLockfile('yarn.lock')).toBe('yarn');
    expect(runnerForLockfile('pnpm-lock.yaml')).toBe('pnpm');
  });

  test('maps nothing else', () => {
    expect(runnerForLockfile('bun.lockb.bak')).toBeNull();
    expect(runnerForLockfile('Cargo.lock')).toBeNull();
  });
});

describe('resolveScope', () => {
  let root = '';

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'cr-scope-'));
    mkdirSync(join(root, 'packages', 'api'), { recursive: true });
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test('resolves the root itself', () => {
    expect(resolveScope({ root, repo: '.' })).toBe(root);
  });

  test('resolves a nested repo', () => {
    expect(resolveScope({ root, repo: 'packages/api' })).toBe(join(root, 'packages', 'api'));
  });

  test('refuses a repo that escapes the root', () => {
    // The check that stops `repo: '../../etc'`.
    expect(resolveScope({ root, repo: '../../etc' })).toBeNull();
    expect(resolveScope({ root, repo: 'packages/../../../etc' })).toBeNull();
  });

  test('refuses a relative root, which would resolve against the server cwd', () => {
    expect(resolveScope({ root: 'relative/path', repo: '.' })).toBeNull();
    expect(resolveScope({ root: '', repo: '.' })).toBeNull();
  });

  test('refuses a path that does not exist, or is a file', () => {
    expect(resolveScope({ root, repo: 'nope' })).toBeNull();
    writeFileSync(join(root, 'a-file.txt'), 'x');
    expect(resolveScope({ root, repo: 'a-file.txt' })).toBeNull();
  });
});

describe('resolveRunner', () => {
  let root = '';

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'cr-runner-'));
    mkdirSync(join(root, 'packages', 'api'), { recursive: true });
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test('a declared packageManager beats a lockfile', () => {
    writeFileSync(join(root, 'bun.lock'), '');
    const file = join(root, 'packages', 'api', 'package.json');
    expect(resolveRunner(root, file, '{"packageManager":"pnpm@9"}')).toBe('pnpm');
  });

  test('the nearest lockfile decides, walking up', () => {
    // No declared field: the root's `bun.lock` is the only one in the tree.
    const file = join(root, 'packages', 'api', 'package.json');
    expect(resolveRunner(root, file, '{}')).toBe('bun');
  });

  test('a nested lockfile beats the one above it', () => {
    writeFileSync(join(root, 'packages', 'api', 'package-lock.json'), '');
    const file = join(root, 'packages', 'api', 'package.json');
    expect(resolveRunner(root, file, '{}')).toBe('npm');
  });

  test('no lockfile at all falls back to bun', () => {
    const bare = mkdtempSync(join(tmpdir(), 'cr-bare-'));
    expect(resolveRunner(bare, join(bare, 'package.json'), '{}')).toBe('bun');
    rmSync(bare, { recursive: true, force: true });
  });

  test('an unparseable package.json falls through to the lockfile walk', () => {
    const file = join(root, 'packages', 'api', 'package.json');
    expect(resolveRunner(root, file, '{ not json')).toBe('npm');
  });
});

describe('scanScope', () => {
  let root = '';

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'cr-scan-'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { dev: 'x' }, packageManager: 'bun@1.4.2' }));
    writeFileSync(join(root, 'Makefile'), '.PHONY: build\nbuild:\n\techo');
    writeFileSync(join(root, 'justfile'), 'lint:\n  echo');
    // A nested package with its own lockfile, and a node_modules that must NOT
    // be walked into.
    mkdirSync(join(root, 'packages', 'web'), { recursive: true });
    writeFileSync(join(root, 'packages', 'web', 'package.json'), JSON.stringify({ scripts: { build: 'y' } }));
    writeFileSync(join(root, 'packages', 'web', 'package-lock.json'), '{}');
    mkdirSync(join(root, 'node_modules', 'dep'), { recursive: true });
    writeFileSync(join(root, 'node_modules', 'dep', 'package.json'), JSON.stringify({ scripts: { evil: 'z' } }));
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test('groups by file, one group per command file, in a stable order', () => {
    const listing = scanScope({ root, repo: '.' });
    if ('error' in listing) throw new Error(listing.error);
    expect(listing.groups.map((group) => group.file)).toEqual(['package.json', 'packages/web/package.json', 'Makefile', 'justfile']);
  });

  test('the node_modules copy is never listed', () => {
    const listing = scanScope({ root, repo: '.' });
    if ('error' in listing) throw new Error(listing.error);
    // The measured failure this pins: Bun.Glob's `ignore` does not exclude it.
    expect(listing.groups.some((group) => group.file.includes('node_modules'))).toBe(false);
  });

  test('a command id names its file, kind and name — never a command line', () => {
    const listing = scanScope({ root, repo: '.' });
    if ('error' in listing) throw new Error(listing.error);
    const rootPkg = listing.groups.find((group) => group.file === 'package.json')!;
    expect(rootPkg.commands[0].id).toBe('package.json#package:dev');
    expect(rootPkg.runner).toBe('bun');
    expect(rootPkg.commands[0].label).toBe('bun run dev');
  });

  test('each package group gets its own runner, from its own lockfile', () => {
    const listing = scanScope({ root, repo: '.' });
    if ('error' in listing) throw new Error(listing.error);
    const web = listing.groups.find((group) => group.file === 'packages/web/package.json')!;
    expect(web.runner).toBe('npm');
    expect(web.commands[0].label).toBe('npm run build');
  });

  test('the cwd is the command file\'s own directory, relative to the scope', () => {
    const listing = scanScope({ root, repo: '.' });
    if ('error' in listing) throw new Error(listing.error);
    // What makes `make build` in `packages/api` a different command from the one
    // at the root, and what lets a script's relative path resolve.
    expect(listing.groups.find((group) => group.file === 'Makefile')!.cwd).toBe('.');
    expect(listing.groups.find((group) => group.file === 'packages/web/package.json')!.cwd).toBe('packages/web');
  });

  test('a scope that escapes the root is refused, not scanned', () => {
    const listing = scanScope({ root, repo: '../../etc' });
    expect('error' in listing).toBe(true);
  });

  test('a nested repo is scanned on its own', () => {
    const listing = scanScope({ root, repo: 'packages/web' });
    if ('error' in listing) throw new Error(listing.error);
    expect(listing.groups.map((group) => group.file)).toEqual(['package.json']);
    expect(listing.groups[0].cwd).toBe('.');
  });
});

describe('the detector table', () => {
  test('every detector states an argv, and its label is that argv joined', () => {
    // The invariant the table exists for: the label is what the row SHOWS and the
    // argv is what RUNS, so they cannot be two answers. A detector that built a
    // label of its own could say `npm run dev` while running `bun run dev`.
    //
    // Each detector is fed a MINIMAL VALID file, and a detector with no sample
    // fails by name — a new source has to add one, which is also what stops a
    // sample from silently covering nothing.
    for (const detector of DETECTORS) {
      const key = detector.filenames[0] ?? detector.paths?.[0] ?? detector.kind;
      const sample = SAMPLES[key];
      expect(sample, `no sample for ${key}`).toBeDefined();
      const commands = detector.parse(sample!, stubContext());
      // A detector that lists nothing from its own sample proves nothing about
      // the invariant, so an empty answer is a failure too.
      expect(commands.length, `${key} listed nothing`).toBeGreaterThan(0);
      for (const command of commands) {
        expect(command.label).toBe(command.argv.join(' '));
        expect(command.argv.length).toBeGreaterThan(0);
      }
    }
  });

  test('no filename is claimed by two detectors', () => {
    // Two claims would make the walk's answer depend on table order, which is a
    // silent change the next time a row moves.
    const seen = new Map<string, string>();
    for (const detector of DETECTORS) {
      for (const filename of detector.filenames) {
        expect(seen.has(filename)).toBe(false);
        seen.set(filename, detector.kind);
      }
    }
  });

  test('claims the sources it says it does', () => {
    const cases: Array<[string, CommandKind]> = [
      ['package.json', 'package'],
      ['Makefile', 'make'],
      ['GNUmakefile', 'make'],
      ['justfile', 'just'],
      ['Taskfile.yml', 'task'],
      ['deno.jsonc', 'deno'],
      ['pyproject.toml', 'python'],
      ['Pipfile', 'pipenv'],
      ['manage.py', 'django'],
      ['compose.yml', 'compose'],
      ['go.mod', 'go'],
      ['Cargo.toml', 'rust'],
      ['composer.json', 'php'],
      ['artisan', 'php'],
      ['build.gradle', 'java'],
      ['build.gradle.kts', 'java'],
      ['pom.xml', 'java'],
      ['mix.exs', 'elixir'],
    ];
    for (const [filename, kind] of cases) expect(detectorFor(filename)?.kind).toBe(kind);
  });

  test('a SUFFIX path is claimed, and its bare basename is not', () => {
    // `.cargo/config.toml` is the reason `paths` exists: `config.toml` alone is
    // far too common a name to claim, so the basename must resolve to nothing and
    // the repo-relative path must resolve to the Rust config.
    expect(detectorFor('config.toml')).toBeNull();
    expect(detectorFor('config.toml', '.cargo/config.toml')?.kind).toBe('rust');
    // And a `config.toml` somewhere unrelated is still unclaimed.
    expect(detectorFor('config.toml', 'app/config.toml')).toBeNull();
  });

  test('claims nothing else', () => {
    expect(detectorFor('package.json.bak')).toBeNull();
    expect(detectorFor('Makefile.am')).toBeNull();
    expect(detectorFor('README.md')).toBeNull();
    expect(detectorFor('go.sum')).toBeNull();
    expect(detectorFor('Cargo.lock')).toBeNull();
  });

  test('reports every claimed filename, for the panel\'s own note', () => {
    const names = claimedFilenames();
    expect(names).toContain('package.json');
    expect(names).toContain('go.mod');
    // Sorted and unique, so the note is stable between reads.
    expect([...names].sort()).toEqual(names);
    expect(new Set(names).size).toBe(names.length);
  });
});

/**
 * A minimal VALID file per source, keyed by its first filename.
 *
 * Keyed that way because a kind is not unique — `php` covers `composer.json` and
 * `artisan`, `java` covers Gradle and Maven — while a first filename is, and the
 * test above asserts that no filename is claimed twice.
 */
const SAMPLES: Record<string, string> = {
  'package.json': '{"scripts":{"dev":"x"}}',
  'deno.jsonc': '{"tasks":{"build":"x"}}',
  Makefile: 'build:\n\techo',
  justfile: 'build:\n  echo',
  'Taskfile.yml': 'tasks:\n  build:\n    cmds: [x]',
  'pyproject.toml': '[tool.poe.tasks]\nbuild = "x"',
  Pipfile: '[scripts]\nbuild = "x"',
  'manage.py': '',
  'docker-compose.yml': 'services:\n  web:\n    image: x',
  'go.mod': 'module example.com/app',
  'Cargo.toml': '[package]\nname = "app"',
  '.cargo/config.toml': '[alias]\nb = "build"',
  'composer.json': '{"scripts":{"test":"x"}}',
  artisan: '',
  'build.gradle': 'plugins {}',
  'pom.xml': '<project/>',
  'mix.exs': 'defp aliases do\n  setup: ["deps.get"]\nend',
};

/**
 * A context whose directory reads answer one directory, `app`.
 *
 * Non-empty because `go.mod` finds its commands in `cmd/<name>` and would
 * otherwise list nothing — which the invariant test treats as a failure.
 */
function stubContext(): DetectorContext {
  return { file: '', dir: '', entries: () => ['app'], dirs: () => ['app'] };
}
