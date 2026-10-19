/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Linking Kabmo's own packages into a plugin's `node_modules`.
 *
 * A plugin declares `@kabmo-labs/*` as OPTIONAL PEER dependencies: the host
 * provides them, so the plugin must never fetch them from a registry. The
 * `optional` flag is the load-bearing half — measured on Bun 1.4.2 with the
 * package absent from the registry, `dependencies` exits 1, a plain
 * `peerDependencies` entry exits 1 with the same 404, and only
 * `peerDependenciesMeta.optional` exits 0. A plugin cloned into the marketplace
 * is built before npm is guaranteed to carry these, so without the flag the
 * install would fail outright.
 *
 * Symlinks rather than copies: the packages are developed in place, and a copy
 * taken at install time would pin a plugin to whatever the sources said that
 * day. A pre-existing entry is replaced, because a plugin that shipped its own
 * (stale) copy would otherwise shadow Kabmo's.
 */

import { mkdir, rm, symlink } from 'fs/promises';
import { dirname, join } from 'path';

/**
 * The `@kabmo-labs/*` packages a plugin may import, as installed on THIS machine.
 *
 * Resolved at runtime rather than listed as paths, because the two install shapes
 * put them in different places: a source checkout has `packages/`, while a
 * published install has them under `node_modules/` with `packages/` not shipped
 * at all. `Bun.resolveSync` answers both — it consults the `workspaces` map in a
 * checkout and `node_modules` in an install.
 *
 * Resolved from THIS module's directory, not the cwd: a plugin's build runs with
 * the plugin's directory as its working directory, so a cwd-relative lookup
 * would search the marketplace and find nothing.
 */
export function kabmoPackageDirs(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of [
    '@kabmo-labs/kabmo-sdk',
    '@kabmo-labs/kabmo-ui',
    '@kabmo-labs/plugin-sdk',
    '@kabmo-labs/ui',
    '@ompchamber/plugin-sdk',
    '@ompchamber/ui',
  ]) {
    try {
      out[name] = dirname(Bun.resolveSync(`${name}/package.json`, import.meta.dir));
    } catch {
      // Not installed: the plugin's build fails with its own module-not-found,
      // which names the specifier the plugin actually wrote.
    }
  }
  return out;
}

/**
 * Symlink Kabmo's packages into a plugin's `node_modules`.
 *
 * Best-effort: a plugin that imports none of them builds fine without this, so a
 * failure here is not a build failure.
 *
 * There is deliberately NO Preact reconciliation here any more. An earlier
 * version pointed each LINKED package's `node_modules/preact` at the plugin's
 * copy, which is the one thing that must never happen: `packages/ui` and
 * `packages/kabmo-sdk` are the HOST's own packages, so rewriting their
 * dependency tree replaced the host's Preact with the plugin's — and since the
 * runtime shim hands the host's `preact/hooks` to every plugin, a plugin that
 * declares `preact` made the host hand out the WRONG hooks instance. The
 * failure is `Cannot read properties of undefined (reading '__H')` on the first
 * render, inside the host's own UI kit.
 *
 * It is also unnecessary: the shim marks `preact` external, so Kabmo's
 * bundler never resolves it through a linked package in the first place.
 */
export async function linkKabmoPackages(root: string): Promise<void> {
  const dirs = kabmoPackageDirs();
  if (Object.keys(dirs).length === 0) return;

  for (const [name, packageRoot] of Object.entries(dirs)) {
    // The scope comes from the NAME, not a hardcoded `@kabmo-labs`: the list
    // above spans two scopes (the current one and the pre-rename
    // `@ompchamber`), and a fixed scope would link `@ompchamber/ui` in as
    // `@kabmo-labs/ui` — overwriting the real kit with a package that is not it.
    const [scope, bare] = name.split('/');
    const dir = join(root, 'node_modules', scope);
    const target = join(dir, bare);
    try {
      await mkdir(dir, { recursive: true });
      await rm(target, { recursive: true, force: true });
      await symlink(packageRoot, target, 'junction');
    } catch {
      // A filesystem without symlink support: the plugin's own build may still
      // work, so this is not fatal.
    }
  }
}

/** @deprecated Use `kabmoPackageDirs`. */
export const chamberPackageDirs = kabmoPackageDirs;

/** @deprecated Use `linkKabmoPackages`. */
export const linkChamberPackages = linkKabmoPackages;
