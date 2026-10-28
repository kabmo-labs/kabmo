/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Directories the user handed the console by DROPPING a file from them.
 *
 * Every fs route resolves a client `root` through an allow-list: the app root,
 * a path beneath it, or a registered workspace. That is the right rule for a
 * panel — a client-supplied path must not become a filesystem grant — but it
 * refuses the most ordinary gesture there is: dragging a report off the Desktop
 * onto the editor. The file is real, the user pointed at it, and the console
 * answered "outside every workspace this console can read".
 *
 * A grant is therefore created by ONE gesture, in ONE place (`POST /api/fs/grant`,
 * called only by the drop path), and it names the dropped file's own DIRECTORY —
 * the granularity a drop actually expresses. Three rules bound it:
 *
 * - **Only a same-origin POST creates one.** A `GET` cannot: a cross-origin page
 *   can fire a `no-cors` request at localhost without reading the answer, and a
 *   grant registered as a side effect would outlive the page that made it.
 * - **A grant is a DIRECTORY, not a subtree of the filesystem.** Dropping
 *   `~/Desktop/report.pdf` makes `~/Desktop` readable; it does not make `~`
 *   readable, and the filesystem root is refused outright.
 * - **The set is small and bounded.** A grant is remembered for the life of the
 *   process, and past `MAX_EXTERNAL_ROOTS` the oldest is dropped — a console
 *   that has been running for a week must not accumulate a path allow-list.
 *
 * It lives on `globalThis` for the reason the database handle does: `bun --hot`
 * re-evaluates this module in place, and a module-level set would forget every
 * open tab's root on the next save of any file.
 */

import path from 'path';

/** How many dropped directories are remembered at once. */
export const MAX_EXTERNAL_ROOTS = 8;

/** The slot, anchored so a hot reload cannot drop the grants an open tab needs. */
interface ExternalRootSlot {
  /** Canonical directories, oldest first. */
  roots: string[];
}

const SLOT_KEY = '__kabmoExternalRoots';

function slot(): ExternalRootSlot {
  const host = globalThis as typeof globalThis & { [SLOT_KEY]?: ExternalRootSlot };
  host[SLOT_KEY] ??= { roots: [] };
  return host[SLOT_KEY];
}

/**
 * The directories currently granted, newest last.
 *
 * Exposed for the tests and for a diagnostic read; nothing in the request path
 * needs the list itself.
 */
export function externalRoots(): readonly string[] {
  return slot().roots;
}

/** Forgets every grant. The tests' own seam. */
export function clearExternalRoots(): void {
  slot().roots = [];
}

/**
 * Whether `dir` is a directory the user dropped a file from.
 *
 * Compared by RESOLVED path: `path.resolve` collapses `..` and a trailing
 * separator, and both spellings name the same directory as far as the fs routes
 * are concerned.
 */
export function isExternalRoot(dir: string): boolean {
  const resolved = path.resolve(dir);
  return slot().roots.includes(resolved);
}

/**
 * Remember `dir` as a root the console may read.
 *
 * Returns the resolved directory, or null when it cannot be a grant: the
 * filesystem root, or a path that is not absolute. `/` is refused because it is
 * the one directory that makes every other path readable, which is not what any
 * drop expressed.
 */
export function grantExternalRoot(dir: string): string | null {
  if (!path.isAbsolute(dir)) return null;
  const resolved = path.resolve(dir);
  if (resolved === path.parse(resolved).root) return null;

  const store = slot();
  // Re-inserting moves it to the newest position, so a root in constant use is
  // not the one evicted.
  store.roots = store.roots.filter((entry) => entry !== resolved);
  store.roots.push(resolved);
  while (store.roots.length > MAX_EXTERNAL_ROOTS) store.roots.shift();
  return resolved;
}
