/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Every `@kabmo-labs/*` subpath imported in this repo must have a `tsconfig.json`
 * `paths` entry.
 *
 * `paths` is not decoration here: it is what resolves a bare specifier when the
 * workspace symlink is not there. The two mechanisms are separate, and the gap
 * between them is silent until it is not:
 *
 * - a specifier WITH a `paths` entry resolves through the mapping, whatever is
 *   installed;
 * - a specifier WITHOUT one falls back to `node_modules`, which in a checkout is
 *   a `bun install` symlink into `packages/`.
 *
 * Adding the `./app` subpath to the SDK therefore did not break anything on the
 * machine that wrote it — the symlink was present and the package's own `exports`
 * map answered. It broke every tree whose `node_modules` predates that export:
 * `bun run build` and, worse, the dev server, which answers `500` on the shell
 * route with `Could not resolve: "@kabmo-labs/kabmo-sdk/app"` and a suggestion
 * to run `bun install`.
 *
 * The rule is deliberately "imported anywhere in the repo", not "imported by
 * src": a plugin's `src/app.tsx` is compiled by Kabmo's bundler with the
 * same resolution, and the tsconfig's `include` covers it for the same reason.
 *
 * Type-only imports are NOT exempt. `paths` is what `tsc` uses too, so a missing
 * entry fails the type check as well — and unlike the bundler case, a type-only
 * subpath has no `exports` fallback to hide behind.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..', '..', '..', '..');

/** Specifier prefixes owned by this workspace. */
const OWNED = /^@kabmo-labs\//;

/** Roots that hold source the bundler and `tsc` both resolve. */
const SOURCE_GLOBS = ['src/**/*.{ts,tsx,js}', 'packages/*/src/**/*.{ts,tsx}', 'marketplace/plugins/*/src/**/*.{ts,tsx}'];

/**
 * Bun's transpiler is the parser, so the specifiers are what the bundler
 * actually sees — an alias or a re-export cannot hide one from it.
 */
const transpiler = new Bun.Transpiler({
  loader: 'tsx',
  tsconfig: readFileSync(resolve(ROOT, 'tsconfig.json'), 'utf8'),
});

interface TsConfig {
  compilerOptions?: { paths?: Record<string, string[]> };
}

const tsconfig = (await Bun.file(resolve(ROOT, 'tsconfig.json')).json()) as TsConfig;
const paths = tsconfig.compilerOptions?.paths ?? {};

/** Every `@kabmo-labs/*` specifier imported anywhere, with one importing file. */
function importedSpecifiers(): Map<string, string> {
  const found = new Map<string, string>();

  for (const pattern of SOURCE_GLOBS) {
    for (const file of new Bun.Glob(pattern).scanSync({ cwd: ROOT })) {
      let imports: Bun.Import[];
      try {
        // A test importing a subpath no production file does still has to
        // resolve for the suite to run, so test files are not excluded.
        imports = transpiler.scanImports(readFileSync(join(ROOT, file), 'utf8'));
      } catch {
        // A shebang line is not parseable as a module; its imports are covered
        // by the files it imports.
        continue;
      }
      for (const record of imports) {
        if (OWNED.test(record.path) && !found.has(record.path)) found.set(record.path, file);
      }
    }
  }
  return found;
}

describe('tsconfig paths cover every workspace subpath', () => {
  const imported = importedSpecifiers();

  test('the scan actually found the workspace imports', () => {
    // A scan that silently matched nothing would make every assertion below
    // vacuous — the failure mode this whole file exists to prevent.
    expect(imported.size).toBeGreaterThan(0);
    expect([...imported.keys()]).toContain('@kabmo-labs/kabmo-sdk/app');
  });

  test('each imported subpath has an entry', () => {
    const missing = [...imported.entries()]
      .filter(([specifier]) => !(specifier in paths))
      .map(([specifier, file]) => `${specifier} (imported by ${file})`);

    expect(missing).toEqual([]);
  });

  test('each entry points at a file that exists', async () => {
    // A stale entry is the other half of the same bug: it resolves, so nothing
    // complains, and the import fails later or silently binds the wrong module.
    const broken: string[] = [];
    for (const [specifier, targets] of Object.entries(paths)) {
      if (!OWNED.test(specifier)) continue;
      for (const target of targets) {
        if (!(await Bun.file(resolve(ROOT, target)).exists())) broken.push(`${specifier} → ${target}`);
      }
    }
    expect(broken).toEqual([]);
  });

  test('no entry points at a module that no longer exists', () => {
    // `@kabmo-labs/kabmo-ui/styles.css` outlived the stylesheet it named; the import
    // was gone, so nothing failed, and the mapping was left pointing at a file
    // that had been deleted.
    expect(Object.keys(paths)).not.toContain('@kabmo-labs/kabmo-ui/styles.css');
  });
});
