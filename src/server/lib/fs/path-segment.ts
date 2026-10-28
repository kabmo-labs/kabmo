/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One rule, two callers: does this id name exactly one child of a root?
 *
 * The purge paths join a session id onto a root to find the directory it owns —
 * `join(sessionsRoot, …)`, `join(btwRoot, sessionId)` — and then remove it
 * recursively. `path.join` NORMALIZES, so a value that is not a plain segment
 * silently retargets the removal:
 *
 *   join(root, '.')  === root          → deletes every child of the root
 *   join(root, '..') === dirname(root) → deletes outside the root
 *   join(root, 'a/b')                  → reaches into a sibling subtree
 *
 * Measured: `DELETE /api/sessions/.` (curl needs `--path-as-is`; it strips the
 * trailing dot itself) passed a `/^[A-Za-z0-9._-]+$/` guard, normalized to the
 * btw root, and removed two unrelated sessions' side-question transcripts.
 *
 * The check is deliberately structural rather than an enumeration of dangerous
 * spellings: an id is safe exactly when it is one non-dot segment. Real ids
 * satisfy that by construction — omp session ids are UUIDs and mock ids are
 * integers — so nothing legitimate is refused.
 *
 * `normalize` is compared, not just scanned for separators, because it is the
 * same operation the callers' `join` performs: asserting the two agree is what
 * makes this a proof about the path that will actually be built, rather than a
 * guess about which inputs look suspicious.
 */

import { normalize } from 'node:path';

/** True when `id` names one child of a root, and nothing else. */
export function isSinglePathSegment(id: string): boolean {
  if (id.length === 0) return false;
  if (id === '.' || id === '..') return false;
  if (id.includes('/') || id.includes('\\')) return false;
  // A NUL byte would truncate the path at the syscall boundary.
  if (id.includes('\0')) return false;
  // The load-bearing assertion: normalization must be a no-op, so `join(root, id)`
  // cannot resolve anywhere but directly under `root`.
  return normalize(id) === id;
}
