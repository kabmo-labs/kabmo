/**
 * The workspace package layout, asserted.
 *
 * The one-prefix-one-package rule is what replaced 112 per-file manifests. A
 * manifest with one file behind it still works, which is why this has to be a
 * test rather than a convention: every export must name a real file, every
 * package directory must be in the release catalog, and no `kabmo-omp-*` style
 * package may reappear beside its family.
 */
import { expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { RELEASE_PACKAGES } from '../release/packages.js';

const ROOT = join(import.meta.dir, '..');
const PACKAGES = join(ROOT, 'packages');
const FAMILIES = ['omp', 'harness', 'acp', 'fs', 'chat', 'session', 'git', 'process', 'settings', 'workspace', 'worktree'];

type Manifest = {
  name: string;
  exports?: Record<string, string>;
  dependencies?: Record<string, string>;
};

function manifest(dir: string): Manifest {
  return JSON.parse(readFileSync(join(PACKAGES, dir, 'package.json'), 'utf8')) as Manifest;
}

const dirs = readdirSync(PACKAGES, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

test('packages/ holds exactly the release catalog', () => {
  expect(dirs).toEqual(RELEASE_PACKAGES.map((entry) => entry.dir.replace('packages/', '')).sort());
});

test('no package is a per-file member of a family', () => {
  const offenders = dirs.filter((dir) => FAMILIES.some((family) => dir.startsWith(`kabmo-${family}-`)));
  expect(offenders).toEqual([]);
});

test('every export names a file that exists', () => {
  const broken: string[] = [];

  for (const dir of dirs) {
    for (const [subpath, target] of Object.entries(manifest(dir).exports ?? {})) {
      if (!target.startsWith('./src/')) broken.push(`${dir}${subpath} -> ${target} (outside src)`);
      else if (!existsSync(join(PACKAGES, dir, target))) broken.push(`${dir}${subpath} -> ${target}`);
    }
  }

  expect(broken).toEqual([]);
});

test('workspace dependencies name a package, never a subpath', () => {
  const names = new Set(RELEASE_PACKAGES.map((entry) => entry.name));
  const broken: string[] = [];

  for (const dir of dirs) {
    for (const [dependency, spec] of Object.entries(manifest(dir).dependencies ?? {})) {
      if (!spec.startsWith('workspace:')) continue;
      if (!names.has(dependency)) broken.push(`${dir} -> ${dependency}`);
    }
  }

  expect(broken).toEqual([]);
});
