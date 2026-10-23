/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Canonical paths and containment for filesystem work.
 *
 * Two traps this exists to close, both measured:
 *
 *  - **A spelling difference is not a difference.** On macOS git prints
 *    `/private/tmp/...` for a directory the caller typed as `/tmp/...`, and
 *    `path.resolve` alone does not reconcile them. A worktree compared against
 *    its own entry answered "not inside", so the session badge silently never
 *    appeared.
 *  - **A missing path cannot be `realpath`'d at all** — and that is exactly the
 *    `missing` worktree, whose directory was removed outside Kabmo. Resolving
 *    the nearest existing ANCESTOR and re-appending the tail is what lets such a
 *    worktree still be matched against the entry git keeps listing.
 *
 * Everything that compares two paths goes through here; `isWithinRoot` in
 * `lib/fs/root.ts` stays the raw prefix test it always was.
 */

import path from 'path';
import { realpath } from 'fs/promises';

/** Absolute, symlink-resolved, no trailing separator. */
export async function canonicalPath(target: string): Promise<string> {
  const absolute = path.resolve(target).replace(/\/+$/, '');
  const pending: string[] = [];
  let cursor = absolute;
  while (true) {
    try {
      const resolved = (await realpath(cursor)).replace(/\/+$/, '');
      return pending.length > 0 ? [resolved, ...pending].join(path.sep) : resolved;
    } catch {
      const parent = path.dirname(cursor);
      // The whole ancestor chain is gone (or this is the filesystem root): the
      // `..`-folded path is the best answer that exists.
      if (parent === cursor) return absolute;
      pending.unshift(path.basename(cursor));
      cursor = parent;
    }
  }
}

/** True when `target` is `root` itself or lies inside it. Both are canonicalized. */
export async function pathHolds(root: string, target: string): Promise<boolean> {
  const [canonicalRoot, canonicalTarget] = await Promise.all([canonicalPath(root), canonicalPath(target)]);
  return canonicalTarget === canonicalRoot || canonicalTarget.startsWith(`${canonicalRoot}${path.sep}`);
}