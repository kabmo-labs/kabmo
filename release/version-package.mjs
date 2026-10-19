/**
 * The version write for a published package.
 *
 * `@semantic-release/npm` is the usual plugin for this and cannot be used here:
 * it writes the version by shelling out to `npm version`, and npm does not
 * support the `workspace:` protocol that `packages/ui` declares its SDK
 * dependency with. Running it inside this workspace root fails outright —
 * measured on npm 11 in a rehearsal of the real pipeline:
 *
 *     npm error code EUNSUPPORTEDPROTOCOL
 *     npm error Unsupported URL Type "workspace:": workspace:*
 *
 * npm reifies the whole workspace tree to run `version`, so the failure is on a
 * sibling package's manifest and has nothing to do with the one being released.
 * (It also removed `node_modules` outright in the first rehearsal.)
 *
 * What is left of the plugin's job here is one field, because this pipeline
 * never publishes: `publish-plugins.yml` does, with `bun publish`, which packs
 * the workspace protocol correctly (verified: the published tarball carries the
 * exact SDK version, not `workspace:*`). So the version is written directly,
 * with no package manager in the loop.
 *
 * The manifest is re-serialized with the same two-space indent and trailing
 * newline the files already use, and `JSON.parse` preserves key order, so a
 * release commit's diff is the version line alone.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * Read a package's manifest.
 *
 * @param {string} cwd
 * @param {string} dir
 * @returns {object}
 */
function readManifest(cwd, dir) {
  return JSON.parse(readFileSync(join(cwd, dir, 'package.json'), 'utf8'));
}

/**
 * Refresh `bun.lock` so its recorded workspace versions match the manifests.
 *
 * **This is load-bearing, and its absence published a wrong dependency.**
 * `bun.lock` records a version for every workspace package, and `bun publish`
 * substitutes a `workspace:` spec from THAT record rather than from the
 * manifest on disk. So bumping a package's version and packing a dependent
 * package in the same run publishes the dependency at its PREVIOUS version:
 * measured, `@kabmo-labs/ui@2.0.0` went to npm declaring
 * `"@kabmo-labs/plugin-sdk": "1.0.0"` while the SDK was 2.0.0 on the registry —
 * an install that resolves the old SDK, which is exactly the incompatibility
 * the 2.0.0 release existed to announce.
 *
 * Reproduced in isolation: bump `packages/a/package.json` to 2.0.0 without
 * running `bun install`, and `bun pm pack` in `packages/b` (which depends on
 * `a` at `workspace:*`) still writes `"a": "1.0.0"`.
 *
 * `--lockfile-only` is deliberate: the release job has already installed, and
 * the only thing that needs to change is the lock's record of the version, so
 * `node_modules` is left alone.
 *
 * @param {string} cwd
 */
function refreshLockfile(cwd) {
  const result = spawnSync('bun', ['install', '--lockfile-only'], {
    cwd,
    encoding: 'utf8',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`bun install --lockfile-only failed:\n${result.stderr}`);
  }
}

/**
 * The version `bun.lock` records for a workspace directory, or `null`.
 *
 * Read rather than parsed: the lockfile is Bun's own JSONC-ish format, and the
 * only fact needed here is one version inside one entry.
 *
 * @param {string} cwd
 * @param {string} dir
 * @returns {string|null}
 */
function lockedVersion(cwd, dir) {
  let lock;

  try {
    lock = readFileSync(join(cwd, 'bun.lock'), 'utf8');
  } catch {
    // A tree with no lockfile has nothing to refresh or verify.
    return null;
  }

  const escaped = dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`"${escaped}"\\s*:\\s*\\{[^}]*"version"\\s*:\\s*"([^"]+)"`).exec(lock);

  return match ? match[1] : null;
}

/**
 * A semantic-release plugin object that keeps one package's version in its own
 * manifest.
 *
 * Returned as an object rather than a module: semantic-release accepts a plain
 * object in `plugins` and reads its step names off it, which is what lets the
 * directory be a closure instead of another config option.
 *
 * @param {string} dir Package directory, relative to the repository root.
 * @returns {{verifyConditions: Function, prepare: Function}}
 */
export function versionPackagePlugin(dir) {
  return {
    verifyConditions(_pluginConfig, { cwd, logger }) {
      const manifest = readManifest(cwd, dir);

      if (manifest.private === true) {
        throw new Error(`${dir} is private; a private package has no version to release`);
      }

      if (!manifest.version) {
        throw new Error(`${dir}/package.json declares no version`);
      }

      logger.log(`${manifest.name} is at ${manifest.version}`);
    },

    prepare(_pluginConfig, { cwd, nextRelease, logger }) {
      const path = join(cwd, dir, 'package.json');
      const manifest = readManifest(cwd, dir);

      manifest.version = nextRelease.version;
      writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
      logger.log(`Wrote ${nextRelease.version} to ${dir}/package.json`);

      refreshLockfile(cwd);

      // Verified, not assumed. A `bun install` that did not actually move the
      // record would leave the dependent package pinning the previous version —
      // the failure this refresh exists to prevent — and the release would
      // publish it silently. Failing here stops the release before the tag.
      const locked = lockedVersion(cwd, dir);

      if (locked !== null && locked !== nextRelease.version) {
        throw new Error(
          `bun.lock records ${locked} for ${dir} after refreshing; expected ${nextRelease.version}`,
        );
      }

      logger.log(`Refreshed bun.lock (${dir} -> ${nextRelease.version})`);
    },
  };
}
