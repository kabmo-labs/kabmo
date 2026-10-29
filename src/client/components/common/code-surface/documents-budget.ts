/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * How many documents the editor keeps alive, and how many BYTES.
 *
 * Split out of `documents.ts` because the numbers are a policy with their own
 * reasons, and because that module is at the repo's per-file ceiling:
 *
 * - **The tab count is not a memory bound.** A text file's ceiling is 32 MiB
 *   (see the editor's `EDITOR_MAX_BYTES_BY_EXT`), so twelve large files is up to
 *   384 MB of document text — plus CodeMirror's rope and each tab's undo
 *   history, which holds whole-document snapshots.
 * - **So the cache is bounded by the text it holds as well.** Past the budget
 *   the least recently used document is dropped even while the count is under
 *   the tab bound.
 * - **The ACTIVE document is never the one dropped.** Losing an open tab's undo
 *   history is the exact failure the cache exists to prevent; losing a CLOSED
 *   tab's is the intended cost, which is why the drop is LRU and not
 *   oldest-first.
 */

/** States kept alive; past this the least recently used one is dropped. */
export const MAX_CACHED_DOCUMENTS = 12;

/** Text kept alive across every cached state. */
export const MAX_CACHED_CHARS = 8 * 1024 * 1024;

export interface CachedDocument {
  /** The document's length in characters, which is what the budget counts. */
  chars: number;
}

/**
 * Which keys to drop so both budgets hold, oldest first.
 *
 * `keys` is the cache's own insertion order (least recently used first, because
 * every touch re-inserts), and `keep` is the document that was just created or
 * touched — it is never returned, so the caller can never evict the document it
 * is about to hand back.
 */
export function documentsToEvict(
  keys: readonly string[],
  chars: (key: string) => number,
  keep: string,
): string[] {
  const dropped: string[] = [];
  let count = keys.length;
  let total = 0;
  for (const key of keys) total += chars(key);
  for (const key of keys) {
    if (count <= 1) break;
    if (count <= MAX_CACHED_DOCUMENTS && total <= MAX_CACHED_CHARS) break;
    if (key === keep) continue;
    dropped.push(key);
    count -= 1;
    total -= chars(key);
  }
  return dropped;
}
