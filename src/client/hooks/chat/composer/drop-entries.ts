/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Turning a `DataTransfer` into the flat list of `File`s a drop attaches.
 *
 * Split out of `file-drop.ts`, which owns the event wiring: everything here is
 * about reading the payload, and it is the part with the browser rules worth
 * documenting.
 *
 * Two rules, both of which produced a bug when ignored:
 *
 * 1. A dropped DIRECTORY is not a readable File: `dataTransfer.files` carries a
 *    size-0 stub for it. Only `DataTransferItem.webkitGetAsEntry()` reveals it
 *    as a directory, so those are walked recursively and attached file by file.
 * 2. `getAsFile()` and `webkitGetAsEntry()` are read from the SAME item, and on
 *    a file-manager drag each call can consume state the other needs — so the
 *    item list is read exactly ONCE, capturing both views in a single pass.
 *
 * The `File`s this returns are only as good as the tick they were captured in:
 * a dropped file's read permission is released when the drop handler returns,
 * so `file-drop.ts` primes the reads before awaiting anything. See `file-reads.ts`.
 */

/**
 * Safety valve: a dropped tree (a repo root, `node_modules`) must not queue
 * thousands of attachments. The walk stops as soon as it is reached.
 */
export const MAX_DROPPED_FILES = 50;

/** Directory nesting limit — a symlinked cycle would otherwise never end. */
export const MAX_DROP_DEPTH = 10;

function readEntryFile(entry: FileSystemFileEntry): Promise<File | null> {
  const { promise, resolve } = Promise.withResolvers<File | null>();
  entry.file(resolve, () => resolve(null));
  return promise;
}

/** `readEntries` yields at most 100 children per call; keep pulling until empty. */
function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  const { promise, resolve } = Promise.withResolvers<FileSystemEntry[]>();
  const all: FileSystemEntry[] = [];
  const readBatch = () => {
    reader.readEntries((batch) => {
      if (batch.length === 0) {
        resolve(all);
        return;
      }
      all.push(...batch);
      readBatch();
    }, () => resolve(all));
  };
  readBatch();
  return promise;
}

/** Walk one directory tree into `out`; true when a cap stopped the walk early. */
async function walkDirectory(
  directory: FileSystemDirectoryEntry,
  out: File[],
  depth: number,
): Promise<boolean> {
  if (depth >= MAX_DROP_DEPTH) return true;
  const children = await readAllEntries(directory.createReader());
  for (const child of children) {
    if (out.length >= MAX_DROPPED_FILES) return true;
    if (child.isFile) {
      const file = await readEntryFile(child as FileSystemFileEntry);
      if (file) out.push(file);
    } else if (child.isDirectory) {
      if (await walkDirectory(child as FileSystemDirectoryEntry, out, depth + 1)) return true;
    }
  }
  return false;
}

/**
 * The two views of a drop's item list, captured in ONE pass.
 *
 * `getAsFile()` and `webkitGetAsEntry()` must both be read from the same item,
 * and on a file-manager drag each call can consume state the other needs. Two
 * separate loops over `items` therefore lose one of them; this captures both
 * while the item is still fresh.
 *
 * `dataTransfer.files` is the PREFERRED source of the `File` objects, not the
 * item list. On a file-manager drag the two are not interchangeable: the item
 * entry can carry correct metadata (name, size) over a backing store that no
 * longer reads, while `files` hands over one that does. Preferring the item list
 * produced a chip with the right name and size whose contents never arrived, and
 * the failure survived every retry because the object itself was unreadable.
 * `files` is also what the working reference implementations read first.
 *
 * The item list still earns its place: it is the ONLY way to see a dropped
 * DIRECTORY (`files` carries a size-0 stub for one), and it is the fallback for
 * a host that populates only `items`.
 */
export interface DroppedEntries {
  /** Real `File` objects, stubs excluded when a better entry exists. */
  files: File[];
  /** Directory entries, for the recursive walk. */
  directories: FileSystemDirectoryEntry[];
  /**
   * The other `File` object for the same dropped file, when the payload exposed
   * it twice — once through `dataTransfer.files`, once through the item list.
   *
   * Which of the two is readable is not knowable up front and differs by
   * context: a drop that reads fine in a browser tab has been observed to fail
   * in an installed app window, with the failing object still reporting the
   * correct name and size. So this is a pair to try, not a preference to settle,
   * and the read path falls back to this entry when the primary yields nothing.
   */
  fallbacks: Map<File, File>;
}

export function readDroppedEntries(dt: DataTransfer): DroppedEntries {
  const itemFiles: File[] = [];
  const directories: FileSystemDirectoryEntry[] = [];

  for (const item of Array.from(dt.items ?? [])) {
    if (item.kind !== 'file') continue;
    // Order matters: the entry first, then the file, in the same iteration.
    const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
    if (entry?.isDirectory) {
      directories.push(entry as FileSystemDirectoryEntry);
      continue;
    }
    const file = typeof item.getAsFile === 'function' ? item.getAsFile() : null;
    // A directory arrives as a 0-byte, type-less stub; it is not a file to read.
    if (file && (file.size > 0 || file.type !== '')) itemFiles.push(file);
  }

  const direct = Array.from(dt.files ?? []);
  const directWithBytes = direct.filter((file) => file.size > 0);
  const itemsWithBytes = itemFiles.filter((file) => file.size > 0);

  // `files` first, then the item list, then whatever exists. Every step keeps
  // the counterpart as a fallback so a read can try the other object rather than
  // depend on this choice being the right one.
  if (directWithBytes.length > 0) {
    return { files: directWithBytes, directories, fallbacks: pairByName(directWithBytes, itemFiles) };
  }
  if (itemsWithBytes.length > 0) {
    return { files: itemsWithBytes, directories, fallbacks: pairByName(itemsWithBytes, direct) };
  }
  if (itemFiles.length > 0) {
    return { files: itemFiles, directories, fallbacks: pairByName(itemFiles, direct) };
  }
  return { files: direct, directories, fallbacks: new Map() };
}

/**
 * Pair each primary file with its counterpart of the same name, so the read path
 * has something else to try. Matching is by name because that is all the two
 * views of one dropped file reliably share.
 */
function pairByName(primary: readonly File[], others: readonly File[]): Map<File, File> {
  const byName = new Map<string, File>();
  for (const file of others) {
    if (!byName.has(file.name)) byName.set(file.name, file);
  }
  const pairs = new Map<File, File>();
  for (const file of primary) {
    const other = byName.get(file.name);
    if (other && other !== file) pairs.set(file, other);
  }
  return pairs;
}

/**
 * Expand a drop into the flat file list the composer attaches: the files it
 * already carries plus every directory's contents, walked recursively.
 * `incomplete` reports that a cap cut the drop short, so the composer can say so
 * instead of silently attaching a prefix.
 *
 * Takes the entries rather than the `DataTransfer`: see {@link readDroppedEntries}
 * for why the item list may only be read once.
 */
export async function expandDroppedFiles(
  entries: DroppedEntries,
): Promise<{ files: File[]; incomplete: boolean }> {
  const files: File[] = [...entries.files];

  // No directory in the payload: the flat list is already the answer.
  if (entries.directories.length === 0) {
    return { files: files.slice(0, MAX_DROPPED_FILES), incomplete: files.length > MAX_DROPPED_FILES };
  }

  let incomplete = false;
  for (const directory of entries.directories) {
    if (files.length >= MAX_DROPPED_FILES) {
      incomplete = true;
      break;
    }
    if (await walkDirectory(directory, files, 0)) {
      incomplete = true;
      break;
    }
  }
  return { files: files.slice(0, MAX_DROPPED_FILES), incomplete };
}

