/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * One directory's entries, as the file explorer renders them.
 *
 * Extracted from `routes/fs/read.ts` so the HTTP route and the realtime `fs:`
 * topic produce the SAME listing — the ignored-path set, the folder-first sort
 * and the unreadable-entry skip are exactly the details two copies would drift
 * on, and a tree that disagrees with itself depending on which path delivered
 * it is worse than either answer alone.
 */

import fs from 'node:fs';
import path from 'node:path';
import { collectIgnoredPaths } from '@/server/lib/fs/git-ignore';

export interface DirectoryEntry {
  id: string;
  name: string;
  type: 'folder' | 'file';
  path: string;
  children?: null;
  is_expanded?: number;
  ignored: boolean;
}

/** How deep a collapsed chain may go before the listing stops walking. */
const MAX_CHAIN_DEPTH = 32;

/**
 * The segments a single-child folder chain runs through, starting at `dir`.
 *
 * A row per directory level spends a row on each level of a package tree, and
 * the reader scrolls through `com`, `java`, `app`, `package` to reach the four
 * files inside. Every editor collapses that, so the listing does too: the row
 * names the whole chain and expands into the DEEPEST directory's contents.
 *
 * Stops at the first directory that holds anything other than exactly one
 * FOLDER — a file, two entries, or nothing at all ends the chain, so a folder
 * of files never folds. The last directory's own contents are a later read, and
 * probing one level past what the row displays would stat a directory nothing
 * shows.
 */
async function folderChain(dir: string): Promise<string[]> {
  const segments = [path.basename(dir)];
  let current = dir;
  for (let depth = 1; depth < MAX_CHAIN_DEPTH; depth += 1) {
    let entries: string[];
    try {
      entries = await fs.promises.readdir(current);
    } catch {
      return segments;
    }
    if (entries.length !== 1) return segments;
    const child = path.join(current, entries[0]!);
    try {
      if (!(await Bun.file(child).stat()).isDirectory()) return segments;
    } catch {
      return segments; // unreadable / broken symlink — the row ends here
    }
    segments.push(entries[0]!);
    current = child;
  }
  return segments;
}

/**
 * Read one directory, folders first then files, each marked ignored or not.
 *
 * EVERY entry is listed — `node_modules`, `.git`, `dist`, `build` and dot-files
 * included. There is no name table: filtering by name cannot tell a dependency
 * tree from a folder of release artifacts (`packages/android/dist` holds the
 * built APKs), and it hid directories the user could not reach any other way.
 * The panel's own signal for "this is untracked noise" is the `ignored` flag,
 * which dims the row via `git check-ignore` instead of deleting it — and a tree
 * that is expensive to expand costs nothing until someone expands it, because
 * children are lazy.
 *
 * A folder holding exactly one folder and nothing else is COLLAPSED into one
 * row naming the chain (`folderChain`). Its `path` is the DEEPEST directory —
 * the one whose contents the row will show, and the one the panel opens,
 * renames and drops on — while `name` is the whole chain relative to the
 * directory being listed, so the row still reads as a path. The client's local
 * edits fold by the same rule (`foldSingleChildFolders`, `lib/fs/file-tree.ts`);
 * two spellings of it is how a create would draw a tree the next read undoes.
 */
export async function listDirectoryEntries(dirPath: string, rootPath: string): Promise<DirectoryEntry[]> {
  const listed = (await fs.promises.readdir(dirPath))
    .map((child) => {
      const full = path.join(dirPath, child);
      // POSIX spelling, because `rel` is not only a display value: it is the
      // tree's id/key, the `fs:` topic's path, and the path handed to
      // `git check-ignore` — which rejects a backslash outright, so on Windows
      // every row came back un-dimmed and keyed `packages\android\dist`. The
      // rest of the server states the same convention (`lib/fs/root.ts`,
      // `lib/fs/transfer.ts`).
      const rel = path.relative(rootPath, full).split(path.sep).join('/');
      return { child, full, rel };
    });

  const mapped = await Promise.all(listed.map(async ({ child, full, rel }): Promise<DirectoryEntry | null> => {
    try {
      const st = await Bun.file(full).stat();
      if (st.isDirectory()) {
        const chain = await folderChain(full);
        if (chain.length > 1) {
          const collapsedPath = `${rel}/${chain.slice(1).join('/')}`;
          return {
            id: collapsedPath,
            name: chain.join('/'),
            type: 'folder',
            path: collapsedPath,
            children: null,
            is_expanded: 0,
            ignored: false,
          };
        }
        return { id: rel, name: child, type: 'folder', path: rel, children: null, is_expanded: 0, ignored: false };
      }
      return { id: rel, name: child, type: 'file', path: rel, ignored: false };
    } catch {
      return null; // unreadable entry / broken symlink — skip
    }
  }));

  const result = mapped.filter((entry): entry is DirectoryEntry => entry !== null);
  // One `git check-ignore` for the whole listing. A collapsed row is asked about
  // its DEEPEST directory: that is the path the row names, and a rule matching
  // any level of the chain matches it too (verified — `.gitignore` holding `a/`
  // answers for `a`, `a/b` and `a/b/c` alike), so no level is left un-asked.
  const ignored = await collectIgnoredPaths(rootPath, result.map((entry) => entry.path));
  for (const entry of result) {
    if (ignored.has(entry.path)) entry.ignored = true;
  }

  result.sort((a, b) => {
    if (a.type === 'folder' && b.type === 'file') return -1;
    if (a.type === 'file' && b.type === 'folder') return 1;
    return a.name.localeCompare(b.name);
  });
  return result;
}
