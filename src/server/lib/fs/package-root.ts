/**
 * Where the running Kabmo package lives, and where its dependencies live.
 *
 * Two questions, deliberately separate, because the install shapes put them in
 * different directories:
 *
 * - `packageRoot()` — the first directory that holds `node_modules`, i.e. where
 *   the DEPENDENCIES are. A source checkout and a non-hoisted install answer
 *   their own root; a hoisted install answers the PARENT of the package, since
 *   a package under `node_modules/kabmo/` has no `node_modules` of its own.
 * - `packageDir()` — the first directory that holds `src/`, i.e. where the
 *   PACKAGE's own files are (`package.json`, `public/`, `dist/client/`, the
 *   source stylesheets). In a hoisted install this is one level BELOW
 *   `packageRoot()`.
 *
 * Both walk up from the running module rather than counting `..` segments. The
 * bundle flattens every server module into `dist/client/index.js`, so a fixed
 * depth is wrong the moment the layout differs from the one it was written for:
 * four `..` from `dist/client` lands on `~/.bun/install/global`, a directory
 * that holds a `package.json` belonging to the GLOBAL INSTALL ROOT — not to
 * Kabmo. Reading the installed version there returned `null`, the update
 * check reported no update, and the self-update classified the copy as
 * "unmanaged" and refused to replace it. Walking up finds the real package in
 * every layout instead.
 */

import { existsSync } from 'node:fs';
import { dirname, join, parse, resolve } from 'node:path';

/**
 * Directories a package root may be found under, nearest first.
 *
 * `startDir` is the running module's directory — the repo root for the
 * TypeScript entry, `dist/client` for the AOT bundle — and walking up from it
 * finds both roots in every install shape. The cwd is included because a source
 * checkout run from elsewhere still resolves its dependencies through it.
 */
export function searchRoots(startDir: string = import.meta.dir, cwd: string = process.cwd()): string[] {
  const roots: string[] = [];
  const seen = new Set<string>();
  const add = (dir: string) => {
    if (dir && !seen.has(dir)) {
      seen.add(dir);
      roots.push(dir);
    }
  };

  let dir = startDir;
  const { root } = parse(dir);
  for (;;) {
    add(dir);
    if (dir === root) break;
    dir = dirname(dir);
  }
  add(resolve(cwd));
  return roots;
}

/**
 * The package root — the first search root that holds `node_modules`.
 *
 * Falling back to the cwd keeps a checkout with no `node_modules` (a publish
 * dry-run) working.
 */
export function packageRoot(startDir: string = import.meta.dir, cwd: string = process.cwd()): string {
  for (const root of searchRoots(startDir, cwd)) {
    // `existsSync` rather than `Bun.file().exists()`: the latter is async and
    // file-only, and `node_modules` is a directory.
    if (existsSync(join(root, 'node_modules'))) return root;
  }
  return cwd;
}

/**
 * The package's own directory — the first search root that holds `src/`.
 *
 * This is the directory holding the running copy's `package.json`, so it is
 * what the self-update reads the installed version from and what the restart
 * helper runs the CLI out of. Resolving either through `packageRoot()` would
 * name the parent in a hoisted install, where neither exists.
 */
export function packageDir(startDir: string = import.meta.dir, cwd: string = process.cwd()): string {
  for (const root of searchRoots(startDir, cwd)) {
    if (existsSync(join(root, 'src'))) return root;
  }
  return packageRoot(startDir, cwd);
}
