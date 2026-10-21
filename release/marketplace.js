/**
 * The bundled marketplace plugins, in the one place their release identities
 * live — and the WATERMARK that decides what has already been released.
 *
 * **A plugin is not published anywhere.** All three are `private: true` and
 * reach a user inside the app's own tarball (`getBundledMarketplaceDir()` is
 * `<package>/marketplace`, and `bun pm pack` carries `marketplace/plugins/*`).
 * So "releasing a plugin" means one thing here: bumping the version its manifest
 * declares, because that number is the only signal `syncBundledPlugins` has. A
 * fix whose version did not move is silently skipped by every existing install —
 * measured: `feat(marketplace): add the command-runner plugin` shipped a
 * broken child environment, and the fix (`fe54637`) could only reach installs
 * because it bumped 1.0.0 → 1.0.1 by hand.
 *
 * `release/release-marketplace.mjs` reads this table, and `release/marketplace.test.js`
 * asserts it against the tree, so a directory can only be stated here.
 */

import { commitsSince as genericCommitsSince, versionWatermark as genericWatermark } from './watermark.js';

/**
 * One bundled plugin.
 *
 * `dir` is relative to the repository root and `id` must equal the manifest's
 * own `id` — the plugin's identity is its manifest, and `marketplace.test.js` holds
 * the two together rather than reading one from the other, for the same reason
 * `release/packages.js` does.
 */
export const BUNDLED_PLUGINS = [
  { dir: 'marketplace/plugins/command-runner', id: 'command-runner' },
  { dir: 'marketplace/plugins/session-info', id: 'session-info' },
  { dir: 'marketplace/plugins/stats', id: 'stats' },
];

/**
 * The commit that last changed a plugin's declared version, or null when the
 * manifest has never carried one.
 *
 * This is the watermark, and it is what makes "already released" a fact rather
 * than a convention. A tag cannot serve: these plugins are released by the APP's
 * release, so a plugin bump rides inside a `chore(release): vX.Y.Z` commit and
 * there is no per-plugin tag to range from. Asking git directly — "which commit
 * last touched the version LINE" — answers exactly the question that matters:
 * everything a plugin's history has to offer is either before the version it
 * currently declares (already out) or after it (not yet).
 *
 * `git log -L` is the right tool and a `git log -p | grep` is not: `-L` follows
 * the line through history, so it reports the commit that CHANGED the version
 * rather than every commit that happened to rewrite the file.
 *
 * @param {string} dir Plugin directory, relative to the repository root.
 * @param {string} cwd The repository to read.
 * @returns {string|null} A commit hash, or null when the file has no such line.
 */
export function versionWatermark(dir, cwd) {
  return genericWatermark(`${dir}/package.json`, '/"version"/', cwd);
}

/**
 * The commits touching a plugin SINCE its version was last written.
 *
 * An empty range is not an error: a plugin whose version watermark is the
 * current HEAD has nothing pending, which is the ordinary state between
 * releases. A watermark that cannot be resolved (a shallow clone, a manifest
 * with no version line) reports every commit the caller collected instead of
 * none — the answer that keeps a release honest, because "cannot tell" must
 * never read as "nothing to do".
 *
 * @param {string} dir Plugin directory, relative to the repository root.
 * @param {string} cwd The repository to read.
 * @param {number} [limit] How far back to walk when there is no watermark.
 * @returns {Array<{hash: string, message: string}>}
 */
export function commitsSinceWatermark(dir, cwd, limit = 200) {
  return genericCommitsSince(dir, cwd, `${dir}/package.json`, '/"version"/', limit);
}
