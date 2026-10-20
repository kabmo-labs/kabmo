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

  const ignored = await collectIgnoredPaths(rootPath, listed.map((entry) => entry.rel));

  const mapped = await Promise.all(listed.map(async ({ child, full, rel }): Promise<DirectoryEntry | null> => {
    try {
      const st = await Bun.file(full).stat();
      const isIgnored = ignored.has(rel);
      if (st.isDirectory()) {
        return { id: rel, name: child, type: 'folder', path: rel, children: null, is_expanded: 0, ignored: isIgnored };
      }
      return { id: rel, name: child, type: 'file', path: rel, ignored: isIgnored };
    } catch {
      return null; // unreadable entry / broken symlink — skip
    }
  }));

  const result = mapped.filter((entry): entry is DirectoryEntry => entry !== null);
  result.sort((a, b) => {
    if (a.type === 'folder' && b.type === 'file') return -1;
    if (a.type === 'file' && b.type === 'folder') return 1;
    return a.name.localeCompare(b.name);
  });
  return result;
}
