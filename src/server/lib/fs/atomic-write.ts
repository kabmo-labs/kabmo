/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Atomic file write: a sibling temp file is fully written, then renamed over
 * the target. rename(2) is atomic on POSIX, so a crash mid-write leaves either
 * the old file or the new one — never a truncated file. The temp file is
 * removed (best-effort) when the write or rename fails.
 *
 * Two properties the plain rename does NOT give you, and both are required for
 * omp's config files:
 *
 * - **Mode.** `Bun.write` creates the temp file with the process umask
 *   (0644/0664), so overwriting a `0600` file — omp opens its own config temp
 *   with `wx, 0o600` — silently loosened the mode of a file holding plaintext
 *   API keys. The existing target's mode is carried onto the replacement; only
 *   a brand-new file uses `createMode`.
 * - **Symlinks.** Renaming onto a symlinked path replaces the symlink with a
 *   regular file. omp resolves the symlink chain and writes to the real target
 *   (`Settings.#resolveYamlWritePath`), so a user who links `config.yml` into a
 *   dotfiles repo keeps the link. The chain is resolved before the temp file is
 *   placed, so the temp lands beside the real target on the same filesystem.
 */

import fs from 'fs';
import { dirname } from 'path';

export interface AtomicWriteOptions {
  /**
   * Mode for a file that does not exist yet. Existing files always keep their
   * own mode. Defaults to `0o644`.
   */
  createMode?: number;
}

/** Writes `data` to `targetPath` via a sibling temp file then rename (atomic on POSIX). */
export async function writeFileAtomic(
  targetPath: string,
  data: string,
  options: AtomicWriteOptions = {},
): Promise<void> {
  // Missing file (first write) or a dangling link throws — the parent is real.
  let resolved = targetPath;
  try {
    resolved = fs.realpathSync.native(targetPath);
  } catch {}
  let mode = options.createMode ?? 0o644;
  try {
    mode = fs.statSync(resolved).mode & 0o777;
  } catch {}
  await fs.promises.mkdir(dirname(resolved), { recursive: true });
  const tempPath = `${resolved}.tmp-${process.pid}-${crypto.randomUUID()}`;
  try {
    await Bun.write(tempPath, data);
    // Bun.write ignores `mode` when creating, so the mode is applied explicitly
    // before the rename — a chmod after would leave a window at the default.
    await fs.promises.chmod(tempPath, mode);
    await fs.promises.rename(tempPath, resolved);
  } catch (error) {
    await fs.promises.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}
