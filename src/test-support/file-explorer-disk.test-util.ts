/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The Files panel harness's fake disk, and the two writes a spec drives it with.
 *
 * A separate module because the harness file is at the repository's line
 * ceiling, and because the disk is the part with its own rules: a create and a
 * rename MUTATE it the way the real route mutates the filesystem, so the very
 * next read agrees with the row the panel just drew. A stub that answered
 * "created" while leaving the folder empty would make every local-edit spec pass
 * against a tree the server would contradict.
 */

/** The fake disk: `path -> child -> (null for a folder, 'file' for a file)`. */
export type Disk = Record<string, Record<string, null | 'file'> | undefined>;

/** One directory's own listing, created on demand. */
function listingOf(disk: Disk, path: string): Record<string, null | 'file'> {
  disk[path] = disk[path] ?? {};
  return disk[path]!;
}

/**
 * Apply a create: every directory on the way exists afterwards, and the entry
 * sits in its parent's listing. Returns the entry's path relative to the root.
 */
export function writeToDisk(disk: Disk, folder: string, name: string, kind: 'file' | 'folder'): string {
  const segments = name.split('/');
  let parent = folder === '.' ? '' : folder;
  for (const segment of segments.slice(0, -1)) {
    listingOf(disk, parent || '.')[segment] = null;
    parent = parent ? `${parent}/${segment}` : segment;
    listingOf(disk, parent);
  }
  const leaf = segments[segments.length - 1];
  listingOf(disk, parent || '.')[leaf] = kind === 'folder' ? null : 'file';
  const created = parent ? `${parent}/${leaf}` : leaf;
  if (kind === 'folder') listingOf(disk, created);
  return created;
}

/** Split a relative path into its directory (`.` at the root) and its name. */
function splitPath(path: string): { dir: string; name: string } {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? { dir: '.', name: path } : { dir: path.slice(0, cut), name: path.slice(cut + 1) };
}

/** Apply a rename: remove the old entry, write the new one, kind preserved. */
export function moveOnDisk(disk: Disk, fromPath: string, toPath: string): void {
  const from = splitPath(fromPath);
  const source = disk[from.dir];
  const kind = source?.[from.name] === null ? 'folder' : 'file';
  if (source) delete source[from.name];
  const to = splitPath(toPath);
  writeToDisk(disk, to.dir, to.name, kind);
}

/** Whether `path` already names an entry of the fake disk. */
export function diskHas(disk: Disk, path: string): boolean {
  const { dir, name } = splitPath(path);
  return (disk[dir] ?? {})[name] !== undefined;
}

/** One directory's entries as the server emits them: folders with `children: null`. */
export function entriesOf(disk: Disk, path: string): unknown[] {
  const dir = disk[path] ?? {};
  return Object.keys(dir).map((child) => {
    const rel = path === '.' ? child : `${path}/${child}`;
    return dir[child] === null
      ? { id: rel, name: child, type: 'folder', path: rel, children: null, ignored: false }
      : { id: rel, name: child, type: 'file', path: rel, ignored: false };
  });
}
