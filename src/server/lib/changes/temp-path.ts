/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Paths the change journal does not track.
 *
 * The journal answers "what did this run do to the workspace". A file under
 * `/tmp` or the OS temp directory is scratch, not workspace: it is transient,
 * it is often written by a test runner or a throwaway script, and a recursive
 * scan of a temp root is unbounded noise. Both the writer and the reader drop
 * these paths, so an old journal that recorded one does not show it either.
 *
 * The roots are resolved through `realpathSync` because macOS exposes `/tmp` as
 * a symlink to `/private/tmp` and `os.tmpdir()` under `/var/folders`, and a tool
 * may spell the same file either way.
 */

import { realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EXCLUDED_ROOTS: readonly string[] = (() => {
  const roots = new Set<string>();
  for (const candidate of ['/tmp', os.tmpdir()]) {
    roots.add(path.resolve(candidate));
    try {
      roots.add(realpathSync(candidate));
    } catch {
      // A temp root that does not exist is simply not excluded.
    }
  }
  return [...roots];
})();

/** True when `absolute` is `/tmp`, the OS temp dir, or anything below them. */
export function isTempPath(absolute: string): boolean {
  const resolved = path.resolve(absolute);
  return EXCLUDED_ROOTS.some((root) => resolved === root || resolved.startsWith(root + path.sep));
}

/** True when `absolute` is `root` or below it. */
export function isInside(absolute: string, root: string): boolean {
  const resolved = path.resolve(absolute);
  const base = path.resolve(root);
  return resolved === base || resolved.startsWith(base + path.sep);
}

/**
 * The journal's rule: a temp path is scratch only when it is OUTSIDE the
 * session cwd. A workspace that itself lives under `/tmp` (a test checkout)
 * keeps its files; a command that writes `/tmp/other` from a real workspace
 * does not.
 */
export function isExcludedTempPath(absolute: string, cwd: string): boolean {
  return isTempPath(absolute) && !isInside(absolute, cwd);
}
