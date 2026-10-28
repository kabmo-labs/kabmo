/**
 * @license
 * SPDX-License-Identifier: MIT
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

/**
 * The directories a single-child folder chain runs through, starting at `path`.
 *
 * Mirrors `folderChain` in `src/server/lib/fs/listing.ts`, including where it
 * stops: a folder holding exactly one FOLDER continues the chain, and a file, a
 * second entry or an empty folder ends it. The harness has to fold like the
 * server does or a spec would assert a tree the real listing never produces.
 */
function chainFrom(disk: Disk, path: string): string[] {
  const segments = [path.slice(path.lastIndexOf('/') + 1)];
  let current = path;
  for (let depth = 1; depth < 32; depth += 1) {
    const dir = disk[current];
    const entries = Object.keys(dir ?? {});
    if (entries.length !== 1 || dir![entries[0]!] !== null) return segments;
    current = `${current}/${entries[0]}`;
    segments.push(entries[0]!);
  }
  return segments;
}

/** One directory's entries as the server emits them: folders with `children: null`. */
export function entriesOf(disk: Disk, path: string): unknown[] {
  const dir = disk[path] ?? {};
  return Object.keys(dir).map((child) => {
    const rel = path === '.' ? child : `${path}/${child}`;
    if (dir[child] !== null) return { id: rel, name: child, type: 'file', path: rel, ignored: false };
    // A folder holding exactly one folder is one collapsed row naming the chain,
    // whose path is the DEEPEST directory — the one whose contents it shows.
    const chain = chainFrom(disk, rel);
    if (chain.length > 1) {
      const deep = `${rel}/${chain.slice(1).join('/')}`;
      return { id: deep, name: chain.join('/'), type: 'folder', path: deep, children: null, ignored: false };
    }
    return { id: rel, name: child, type: 'folder', path: rel, children: null, ignored: false };
  });
}
