/**
 * The Linux shell's release identity, in one place.
 *
 * The app is not published to any registry (see `.github/workflows/publish-linux.yml`),
 * so — exactly like the Android, iOS, macOS and Windows shells, and a bundled
 * marketplace plugin — the version it declares is the whole delivery mechanism.
 * Three things read it:
 *
 * - `build.rs` bakes it into the binary as `KABMO_SHELL_VERSION`, which is what
 *   the page receives as `shellVersion` and what the `.desktop` entry and the
 *   archive name carry;
 * - `scripts/build-app.sh` names the packaged directory and the `.tar.gz` from
 *   it, so a name taken from anywhere else would describe a build nobody can
 *   identify;
 * - `publish-linux.yml` reads it back out of the built binary before uploading.
 *
 * **There is deliberately no User-Agent token and no console download**, and that
 * is the one difference from the two mobile shells. Android and iOS are DOWNLOADED
 * from the console, so the server reads their published version on every request
 * and offers an update when it is newer. A Linux app is installed by a person from
 * the release page — no browser installs a desktop app the way Chrome installs an
 * APK — so nothing in the console offers it, nothing parses a token, and adding
 * one would be a channel with no reader. That is the same decision
 * `packages/macos/version.properties` and `packages/windows/version.properties`
 * document.
 *
 * One shape for every shell (`ANDROID_SHELL`, `IOS_SHELL`, `MACOS_SHELL` and
 * `WINDOWS_SHELL` are the twins), because the question is identical and only the
 * file, the line and the directory differ. `release/linux.test.js` asserts this
 * table against the tree.
 */

import { commitsSince, versionWatermark as genericWatermark } from './watermark.js';

/** One released-by-version artifact. */
export const LINUX_SHELL = {
  /** Directory whose changes ask for a bump. */
  dir: 'packages/linux',
  /** The file carrying the version the build reads. */
  versionFile: 'packages/linux/version.properties',
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
  return genericWatermark(LINUX_SHELL.versionFile, LINUX_SHELL.pattern, cwd);
}

/**
 * The commits touching `packages/linux` since its version was last written.
 *
 * @param {string} cwd The repository to read.
 * @param {number} [limit] How far back to walk when there is no watermark.
 * @returns {Array<{hash: string, message: string}>}
 */
export function commitsSinceWatermark(cwd, limit = 200) {
  return commitsSince(LINUX_SHELL.dir, cwd, LINUX_SHELL.versionFile, LINUX_SHELL.pattern, limit);
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
    if (key.trim() !== LINUX_SHELL.key) continue;
    const value = rest.join('=').trim();
    return value === '' ? null : value;
  }

  return null;
}

/**
 * Replace the `versionName` line in the file's own text.
 *
 * Surgical, like the other shells' bumps and for the same reason: these files are
 * hand-formatted, and a round-trip through a serializer would rewrite the comments
 * that carry the reasoning. The previous value is part of the anchor, so the
 * rewrite cannot land on some other line that happens to start the same way.
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
    new RegExp(`^(\\s*)${LINUX_SHELL.key}([^\\S\\n]*=[^\\S\\n]*)${escapeRegExp(previous)}[^\\S\\n]*$`, 'gm'),
    (_match, indent, separator) => {
      replaced += 1;
      return `${indent}${LINUX_SHELL.key}${separator}${next}`;
    },
  );

  if (replaced !== 1) {
    throw new Error(
      `expected to rewrite 1 ${LINUX_SHELL.key} line, rewrote ${replaced}; refusing to write a partial bump`,
    );
  }

  return out;
}

/** A literal string as a regular expression. */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
