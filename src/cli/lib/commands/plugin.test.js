// `ompchamber plugin` — the subcommand surface and its path handling.
//
// Two things are pinned here, and both were real bugs before they were:
//
// 1. `resolvePath` with an ABSOLUTE segment. `joinPath` strips a leading slash
//    (it is used to build a path FROM a root), so `joinPath(cwd, '/tmp/x')` is
//    `<cwd>/tmp/x`. Measured: `ompchamber plugin new /tmp/x` scaffolded into the
//    repo. The suite is a CLI-level case because the bug was only reachable
//    through an absolute argument.
// 2. `new` produces a project that typechecks. The scaffold writes its own
//    `bundled-types/` and the `paths` that map onto them, so a fresh directory
//    is a working project rather than one that teaches the author the tooling
//    is broken.
//
// Runs the CLI as a subprocess rather than importing `run`: the command writes
// to stdout, shells out to the bundler and terminates on failure, none of which
// is safe in-process.

import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolvePath } from '@/cli/lib/path-utils.js';

// `import.meta.dir` is `src/cli/lib/commands`, so the package root is four up.
const PKG_ROOT = resolvePath(import.meta.dir, '..', '..', '..', '..');
const CLI = join(PKG_ROOT, 'src', 'cli', 'ompchamber.js');

/** Run the CLI from the package root, so its own `pkgRoot` resolution is exercised. */
function cli(args, cwd = PKG_ROOT) {
  const result = Bun.spawnSync({
    cmd: [process.execPath, CLI, ...args],
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return {
    code: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

describe('resolvePath', () => {
  test('an absolute segment discards everything before it', () => {
    expect(resolvePath('/cwd/here', '/tmp/x')).toBe('/tmp/x');
    expect(resolvePath('/cwd/here', '.')).toBe('/cwd/here');
    expect(resolvePath('/cwd/here', 'rel')).toBe('/cwd/here/rel');
  });
});

describe('ompchamber plugin', () => {
  test('bare `plugin` prints its own usage and exits non-zero', () => {
    const result = cli(['plugin']);
    expect(result.stdout).toContain('ompchamber plugin <command>');
    expect(result.code).not.toBe(0);
  });

  test('an unknown subcommand is refused by name', () => {
    const result = cli(['plugin', 'bogus']);
    expect(result.stderr).toContain('Unknown plugin subcommand: bogus');
    expect(result.code).not.toBe(0);
  });

  test('build refuses a directory with no plugin manifest', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'omp-cli-plugin-'));
    try {
      const result = cli(['plugin', 'build', dir]);
      expect(result.stderr).toContain('no "ompchamber" manifest block');
      expect(result.code).not.toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('new scaffolds a project that carries its own declarations and paths', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'omp-cli-scaffold-'));
    const target = join(parent, 'my-plugin');
    try {
      const result = cli(['plugin', 'new', target]);
      expect(result.code).toBe(0);

      // The manifest declares both halves, so the build has two targets.
      const manifest = JSON.parse(await readFile(join(target, 'package.json'), 'utf8'));
      expect(manifest.ompchamber.id).toBe('my-plugin');
      expect(manifest.ompchamber.app).toBe('dist/app.js');
      expect(manifest.ompchamber.server).toBe('dist/server.js');

      // The declarations and the mapping onto them are what make `tsc` work in
      // a directory with no chamber source on disk.
      expect(existsSync(join(target, 'bundled-types/plugin-sdk/index.ts'))).toBe(true);
      expect(existsSync(join(target, 'bundled-types/ui/index.tsx'))).toBe(true);
      // The SDK's own suites are NOT copied: they import `bun:test`, which the
      // plugin's tsconfig does not resolve.
      expect(existsSync(join(target, 'bundled-types/plugin-sdk/app.test.ts'))).toBe(false);

      const tsconfig = JSON.parse(await readFile(join(target, 'tsconfig.json'), 'utf8'));
      expect(tsconfig.compilerOptions.paths['@kabmo-labs/plugin-sdk/app']).toEqual([
        './bundled-types/plugin-sdk/app.ts',
      ]);
      // `baseUrl` is deliberately absent: TypeScript 7 deprecates it, and
      // `paths` resolves relative to the tsconfig without it.
      expect(tsconfig.compilerOptions.baseUrl).toBeUndefined();
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  }, 60_000);

  test('new refuses a non-empty directory rather than mixing into it', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'omp-cli-scaffold-'));
    try {
      const existing = join(parent, 'occupied');
      await Bun.write(join(existing, 'keep.txt'), 'something the user owns');
      const result = cli(['plugin', 'new', existing]);
      expect(result.stderr).toContain('Refusing to scaffold into a non-empty directory');
      expect(result.code).not.toBe(0);
      // And it did not touch what was there.
      expect(await readFile(join(existing, 'keep.txt'), 'utf8')).toBe('something the user owns');
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
