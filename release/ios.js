/**
 * The iOS shell's release identity, in one place.
 *
 * The IPA is not published to any registry (see `.github/workflows/publish-ios.yml`),
 * so — exactly like the Android shell and a bundled marketplace plugin — the
 * version it declares is the whole delivery mechanism. Two things read it:
 *
 * - the shell appends `KabmoIOS/<versionName>` to its WebView User-Agent, and
 *   `GET /api/updates/ios` compares the published asset's version against it to
 *   decide whether to offer an update. That comparison is only meaningful if the
 *   number MOVES when the shell changes.
 * - `fetchShellRelease('ios')` reads the version out of the asset NAME, so the name
 *   has to carry this same number rather than the app's tag.
 *
 * One shape for both shells (`ANDROID_SHELL` is the twin), because the question is
 * identical and only the file, the line and the directory differ. `release/ios.test.js`
 * asserts this table against the tree.
 */

import { commitsSince, versionWatermark as genericWatermark } from './watermark.js';

/** One released-by-version artifact. */
export const IOS_SHELL = {
  /** Directory whose changes ask for a bump. */
  dir: 'packages/ios',
  /** The file carrying the version the build reads. */
  versionFile: 'packages/ios/version.properties',
  /** The line inside that file, as a `git log -L` regex. */
  pattern: '/^versionName=/',
  /** The key the file declares. */
  key: 'versionName',
};

/**
 * The commit that last wrote the shell's version, or null.
 *
 * @param {string} cwd The repository to read.
 * @returns {string|null}
 */
export function versionWatermark(cwd) {
  return genericWatermark(IOS_SHELL.versionFile, IOS_SHELL.pattern, cwd);
}

/**
 * The commits touching `packages/ios` since its version was last written.
 *
 * @param {string} cwd The repository to read.
 * @param {number} [limit] How far back to walk when there is no watermark.
 * @returns {Array<{hash: string, message: string}>}
 */
export function commitsSinceWatermark(cwd, limit = 200) {
  return commitsSince(IOS_SHELL.dir, cwd, IOS_SHELL.versionFile, IOS_SHELL.pattern, limit);
}

/**
 * Read `versionName` out of the properties file.
 *
 * Parsed by hand rather than through a properties library: this is one
 * `key=value` line in a file this repository owns, and a dependency for it would
 * be a dependency for every release run.
 *
 * @param {string} text The file's contents.
 * @returns {string|null} The declared version, or null when the line is absent.
 */
export function readVersionName(text) {
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) continue;
    const [key, ...rest] = trimmed.split('=');
    if (key.trim() !== IOS_SHELL.key) continue;
    const value = rest.join('=').trim();
    return value === '' ? null : value;
  }

  return null;
}

/**
 * Replace the `versionName` line in the file's own text.
 *
 * Surgical, like the Android and marketplace bumps and for the same reason: these
 * files are hand-formatted, and a round-trip through a serializer would rewrite the
 * comments that carry the reasoning. The previous value is part of the anchor, so
 * the rewrite cannot land on some other line that happens to start the same way.
 *
 * @param {string} text The file's source.
 * @param {string} previous The version currently declared.
 * @param {string} next The version to write.
 * @returns {string}
 */
export function replaceVersionLine(text, previous, next) {
  let replaced = 0;
  const out = text.replace(
    // Trailing blanks only — `\s*` would swallow the newline, and the bump would
    // then be the only line in a file that lost its terminator. The separator is
    // captured rather than assumed, so a hand-aligned `versionName = 1.2.3` keeps
    // the spacing it was written with.
    new RegExp(`^(\\s*)${IOS_SHELL.key}([^\\S\\n]*=[^\\S\\n]*)${escapeRegExp(previous)}[^\\S\\n]*$`, 'gm'),
    (_match, indent, separator) => {
      replaced += 1;
      return `${indent}${IOS_SHELL.key}${separator}${next}`;
    },
  );

  if (replaced !== 1) {
    throw new Error(
      `expected to rewrite 1 ${IOS_SHELL.key} line, rewrote ${replaced}; refusing to write a partial bump`,
    );
  }

  return out;
}

/** A literal string as a regular expression. */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
