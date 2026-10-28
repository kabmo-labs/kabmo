/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Files panel's local tree edits: a create and a rename land WITHOUT a
 * reload, and the row they produce is REVEALED.
 *
 * Extracted from the panel because the reveal and the placement are one
 * decision with two halves. A folder holding exactly one folder is collapsed
 * into a single row naming the chain (`lib/deep`), so the ancestors a reveal may
 * expand are the rows that are DRAWN — not the path's own segments. A reveal
 * derived from the path would fill the expansion set with paths nothing draws,
 * and the next refresh would read each of them from disk for nothing.
 *
 * The placement's answer is what the reveal reads, which is why the two live
 * together: `insertEntry`/`moveEntry` return the tree they committed, and this
 * module is the only caller that consumes it.
 */

import { useCallback } from 'preact/hooks';
import type { FsNode } from '@/shared/types';
import { drawnAncestors } from '@/shared/lib/fs/folder-chain';
import { rekeyExpansion } from '@/shared/lib/fs/file-tree';
import type { FileListing } from '@/client/hooks/workspace/file-listing';

export interface FileTreeEditDeps {
  listing: FileListing;
  setExpandedPaths: (updater: (prev: Set<string>) => Set<string>) => void;
  setStoredExpandedPaths: (value: string[]) => void;
  /**
   * Re-read the panel. A local edit answers `null` when the entry is not in the
   * rendered tree — a collapsed folder's contents are not — and re-reading is
   * the only honest way to learn where the row went.
   */
  reload: () => void;
}

export interface FileTreeEdits {
  /** Place a row a create just produced, without re-reading the tree. */
  insertCreated: (entry: { path: string; kind: 'file' | 'folder' }) => void;
  /** Move a row a rename just relocated, without re-reading. */
  moveRenamed: (fromPath: string, toPath: string) => void;
}

export function useFileTreeEdits({
  listing,
  setExpandedPaths,
  setStoredExpandedPaths,
  reload,
}: FileTreeEditDeps): FileTreeEdits {
  /**
   * Open every folder row that leads to `path`.
   *
   * A nested create (`lib/parse.ts`) and a rename into a new folder both make
   * directories the user has never opened, and a row placed inside a collapsed
   * folder is a row nobody can see — the write would look like it failed.
   */
  const reveal = useCallback((path: string, tree: FsNode[]) => {
    const chain = drawnAncestors(tree, path);
    if (chain.length === 0) return;
    setExpandedPaths((prev) => {
      if (chain.every((folder) => prev.has(folder))) return prev;
      const next = new Set(prev);
      for (const folder of chain) next.add(folder);
      setStoredExpandedPaths(Array.from(next));
      return next;
    });
  }, [setExpandedPaths, setStoredExpandedPaths]);

  const insertCreated = useCallback((entry: { path: string; kind: 'file' | 'folder' }) => {
    const tree = listing.insertEntry(entry);
    if (!tree) {
      reload();
      return;
    }
    reveal(entry.path, tree);
  }, [listing, reload, reveal]);

  /**
   * A folder's descendants and every open branch beneath it carry its path as a
   * prefix, so the expansion set is rekeyed in the same step — an open `src`
   * renamed to `lib` must stay open as `lib`, not collapse.
   */
  const moveRenamed = useCallback((fromPath: string, toPath: string) => {
    const tree = listing.moveEntry(fromPath, toPath);
    if (!tree) {
      reload();
      return;
    }
    setExpandedPaths((prev) => {
      const next = rekeyExpansion(prev, fromPath, toPath);
      setStoredExpandedPaths(Array.from(next));
      return next;
    });
    // A rename INTO a new folder (`a.ts` → `nested/a.ts`) has the same problem a
    // nested create does: the destination folder is one nobody has opened.
    reveal(toPath, tree);
  }, [listing, reload, reveal, setExpandedPaths, setStoredExpandedPaths]);

  return { insertCreated, moveRenamed };
}
