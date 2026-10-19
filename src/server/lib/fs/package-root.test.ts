/**
 * The package root resolvers, against the two layouts the running copy can be
 * in — because the bug they exist to prevent is invisible in a checkout.
 *
 * The AOT bundle flattens every server module into `dist/client/index.js`, so a
 * fixed `..` depth (the shape this replaced) resolves `dist/client` → four up →
 * the GLOBAL INSTALL ROOT in a `bun add -g` install. That directory holds a
 * `package.json` of its own, so nothing failed loudly: the update check read
 * `version: undefined` and reported "no update", and the self-update classified
 * the copy as unmanaged. Verified against a real published install before and
 * after.
 *
 * The fixtures stage both layouts under a temp directory and pass the start
 * directory explicitly, which is what makes the published shape reachable from
 * inside the repo — the module's own `import.meta.dir` is always the checkout.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { packageDir, packageRoot } from '@/server/lib/fs/package-root';

const created: string[] = [];

function stage(layout: (root: string) => string): string {
  const root = mkdtempSync(join(tmpdir(), 'kabmo-pkgroot-'));
  created.push(root);
  return layout(root);
}

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A published `bun add -g` install: the package under `node_modules/`, its deps in the parent. */
function bunGlobal(startDir: string): string {
  const global = join(startDir, 'install', 'global');
  const pkg = join(global, 'node_modules', 'kabmo');
  mkdirSync(join(pkg, 'dist', 'client'), { recursive: true });
  mkdirSync(join(pkg, 'src', 'cli'), { recursive: true });
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'kabmo', version: '4.3.0' }));
  writeFileSync(join(pkg, 'src', 'cli', 'kabmo.js'), '#!/usr/bin/env bun\n');
  mkdirSync(join(global, 'node_modules'), { recursive: true });
  // The global install root carries its own package.json, which is what made the
  // fixed-depth resolver read a version belonging to the wrong thing.
  writeFileSync(join(global, 'package.json'), JSON.stringify({ dependencies: { kabmo: '4.3.0' } }));
  return join(pkg, 'dist', 'client');
}

describe('packageDir', () => {
  test('finds the package under a hoisted bun global install', () => {
    const startDir = stage(bunGlobal);
    const dir = packageDir(startDir, startDir);

    expect(dir.endsWith(join('node_modules', 'kabmo'))).toBe(true);
    expect(dir.endsWith(join('install', 'global'))).toBe(false);
  });

  test('finds the package in a source checkout, where src/ is beside the module', () => {
    const startDir = stage((root) => {
      mkdirSync(join(root, 'src', 'server', 'lib'), { recursive: true });
      mkdirSync(join(root, 'node_modules'), { recursive: true });
      return join(root, 'src', 'server', 'lib');
    });

    expect(packageDir(startDir, startDir)).toBe(join(startDir, '..', '..', '..'));
  });

  test('prefers the nearest root, so a nested install does not lose to an ancestor', () => {
    const startDir = stage((root) => {
      // An outer package root that would match first if the walk did not stop at
      // the nearest one.
      mkdirSync(join(root, 'src'), { recursive: true });
      const inner = join(root, 'packages', 'kabmo');
      mkdirSync(join(inner, 'src', 'server'), { recursive: true });
      return join(inner, 'src', 'server');
    });

    expect(packageDir(startDir, startDir)).toBe(join(startDir, '..', '..'));
  });
});

describe('packageRoot', () => {
  test('answers the dependency root, which is the parent in a hoisted install', () => {
    const startDir = stage(bunGlobal);
    expect(packageRoot(startDir, startDir).endsWith(join('install', 'global'))).toBe(true);
  });

  test('falls back to the cwd when no root holds node_modules', () => {
    const startDir = stage((root) => {
      mkdirSync(join(root, 'empty'), { recursive: true });
      return join(root, 'empty');
    });

    expect(packageRoot(startDir, startDir)).toBe(startDir);
  });
});
