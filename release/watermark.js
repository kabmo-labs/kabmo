/**
 * The version WATERMARK, shared by every artifact this repository releases
 * without a tag of its own.
 *
 * A bundled plugin and the Android shell are both delivered by a number written
 * into a checked-in file: `syncBundledPlugins` compares versions, and the
 * console's APK download button compares the published asset's version against
 * the one the running app reports. Neither has a per-artifact tag, so "what has
 * already been released" has to be a fact about history rather than a
 * convention — and the fact is "the commit that last wrote the version LINE".
 *
 * `git log -L` is the right tool and `git log -p | grep` is not: `-L` follows
 * the line through history, so it reports the commit that CHANGED the version
 * rather than every commit that happened to rewrite the file.
 *
 * Both artifacts live in this one module because they ask the same question of
 * different files — a `package.json` version line and a `versionName=` line —
 * and two copies of the range logic is how one of them starts including its own
 * bump commit.
 */

import { spawnSync } from 'node:child_process';

/**
 * The commit that last changed a version line, or null when the file has no
 * such line (or git cannot answer).
 *
 * @param {string} file File, relative to the repository root.
 * @param {string} pattern A `git log -L` regex, slash-delimited, e.g. `/"version"/`.
 * @param {string} cwd The repository to read.
 * @returns {string|null} A commit hash, or null.
 */
export function versionWatermark(file, pattern, cwd) {
  const result = spawnSync('git', ['log', '-s', '--format=%H', '-L', `${pattern},+1:${file}`], {
    cwd,
    encoding: 'utf8',
  });

  if (result.status !== 0) return null;

  // Newest first, so the first line of output is the commit being asked for.
  const hash = result.stdout
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '');

  return hash ?? null;
}

/**
 * The commits touching a directory SINCE its version was last written.
 *
 * An empty range is not an error: an artifact whose watermark is the current
 * HEAD has nothing pending, which is the ordinary state between releases. A
 * watermark that cannot be resolved (a shallow clone, a file with no version
 * line) reports every commit the caller collected instead of none — the answer
 * that keeps a release honest, because "cannot tell" must never read as
 * "nothing to do".
 *
 * @param {string} dir Directory, relative to the repository root.
 * @param {string} cwd The repository to read.
 * @param {string} file The file carrying the version, relative to the root.
 * @param {string} pattern The `git log -L` regex for that version line.
 * @param {number} [limit] How far back to walk when there is no watermark.
 * @returns {Array<{hash: string, message: string}>}
 */
export function commitsSince(dir, cwd, file, pattern, limit = 200) {
  const watermark = versionWatermark(file, pattern, cwd);
  const range = watermark ? `${watermark}..HEAD` : `-${limit}`;

  const result = spawnSync('git', ['log', `--format=%H%x1f%B%x1e`, range, '--', dir], {
    cwd,
    encoding: 'utf8',
    // A long history of full messages is still far below this; the default 1 MB
    // would truncate silently and drop commits from the analysis.
    maxBuffer: 256 * 1024 * 1024,
  });

  if (result.status !== 0) return [];

  return result.stdout
    .split('\x1e')
    .map((chunk) => chunk.replace(/^\n+/, ''))
    .filter((chunk) => chunk.trim() !== '')
    .map((chunk) => {
      const [hash, ...body] = chunk.split('\x1f');

      return { hash, message: body.join('\x1f').trim() };
    });
}
