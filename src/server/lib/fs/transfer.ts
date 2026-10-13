/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Copy, move and duplicate for one entry of the Files panel's working tree.
 *
 * The route resolves and vets the two paths (both inside the scoped root); this
 * module owns what happens once they are legal, and it owns the one rule a
 * naive implementation gets wrong: **a paste never overwrites**. `cp` and
 * `rename` both clobber silently, so a paste onto an existing name would
 * destroy the file the user meant to keep. The name is therefore made unique
 * FIRST (against the destination directory's real listing), which also gives
 * Duplicate its `a copy.txt` naming.
 *
 * `moveEntry`'s `EXDEV` fallback is not decoration: `rename` is atomic and
 * instant but only within one filesystem, and a workspace on another volume
 * answers `EXDEV`. Copy-then-remove is what makes a cross-device paste work
 * instead of failing with an errno the panel cannot explain.
 */

import fs from 'node:fs';
import path from 'node:path';
import { duplicateName, uniqueName } from '@/shared/lib/fs/clipboard';

/** What the route answers with, once a transfer settled. */
export interface TransferOutcome {
  /** Path the entry landed at, relative to the scoped root (POSIX separators). */
  path?: string;
  error?: string;
  status?: number;
}

/** A path relative to the scoped root, in the POSIX spelling the tree renders by. */
export function toRelPath(root: string, target: string): string {
  return path.relative(root, target).split(path.sep).join('/');
}

/** Names already taken in a directory; empty when it cannot be read. */
async function takenNames(dir: string): Promise<Set<string>> {
  try {
    return new Set(await fs.promises.readdir(dir));
  } catch {
    return new Set();
  }
}

/** Copy a file or folder, refusing to overwrite anything already there. */
export async function copyEntry(source: string, destination: string): Promise<void> {
  await fs.promises.cp(source, destination, { recursive: true, errorOnExist: true, force: false });
}

/**
 * Move a file or folder, falling back to copy-then-remove across filesystems.
 *
 * Only `EXDEV` is retried: any other errno is the real answer (a missing
 * source, a permission), and swallowing it would turn a refusal into a silent
 * success.
 */
export async function moveEntry(source: string, destination: string): Promise<void> {
  try {
    await fs.promises.rename(source, destination);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
  }
  await copyEntry(source, destination);
  await fs.promises.rm(source, { recursive: true, force: true });
}

/**
 * Paste an already-vetted `sourcePath` into `destinationDir` under a name that
 * is free there.
 *
 * `sourcePath` arrives resolved and inside the scoped root; the containment
 * check here is the one `resolveWithinRoot` cannot make — a SYMLINK under the
 * destination could point back into the source, and a copy would then recurse
 * into the tree it is writing. `realpath` on both sides is what closes it.
 */
export async function pasteEntry(options: {
  scopedRoot: string;
  sourcePath: string;
  destinationDir: string;
  mode: 'copy' | 'cut';
}): Promise<TransferOutcome> {
  const { scopedRoot, sourcePath, destinationDir, mode } = options;
  const sourceDir = path.dirname(sourcePath);
  const taken = await takenNames(destinationDir);
  // A cut within its OWN folder is not in its own way: the entry being moved IS
  // that name, and counting it as taken would turn "paste back into the same
  // folder" into a rename to `a copy.ts`. A cut into a DIFFERENT folder is:
  // there the existing name belongs to another entry.
  if (mode === 'cut' && sourceDir === destinationDir) taken.delete(path.basename(sourcePath));
  const name = uniqueName(path.basename(sourcePath), (candidate) => taken.has(candidate));
  const destination = path.join(destinationDir, name);

  if (mode === 'cut' && destination === sourcePath) {
    return { error: `${path.basename(sourcePath)} is already in this folder`, status: 409 };
  }
  // The containment check `resolveWithinRoot` cannot make: the destination path
  // is inside the root and outside the source, but the DIRECTORY it resolves to
  // may not be — a symlink in the destination can point back into the source,
  // and the copy would then recurse into the tree it is writing. `realpath` of
  // the destination's PARENT is what resolves that (the destination itself does
  // not exist yet, so it has no real path of its own).
  const realSource = await fs.promises.realpath(sourcePath).catch(() => sourcePath);
  const realDestDir = await fs.promises.realpath(destinationDir).catch(() => destinationDir);
  const realDestination = path.join(realDestDir, name);
  if (realDestination === realSource || realDestination.startsWith(realSource + path.sep)) {
    return { error: 'Cannot paste an entry into itself', status: 409 };
  }

  if (mode === 'cut') {
    await moveEntry(sourcePath, destination);
  } else {
    await copyEntry(sourcePath, destination);
  }
  return { path: toRelPath(scopedRoot, destination) };
}

/** Copy `sourcePath` to `destinationName` beside it, refusing an existing name. */
export async function duplicateEntry(options: {
  scopedRoot: string;
  sourcePath: string;
  destinationName: string;
}): Promise<TransferOutcome> {
  const { scopedRoot, sourcePath, destinationName } = options;
  const dir = path.dirname(sourcePath);
  const destination = path.join(dir, destinationName);
  await copyEntry(sourcePath, destination);
  return { path: toRelPath(scopedRoot, destination) };
}

/** The `a copy.txt` / `src copy` name a duplicate of `sourcePath` should take. */
export async function nextDuplicateName(sourcePath: string, kind: 'file' | 'folder'): Promise<string> {
  const taken = await takenNames(path.dirname(sourcePath));
  return duplicateName(path.basename(sourcePath), kind, (candidate) => taken.has(candidate));
}
