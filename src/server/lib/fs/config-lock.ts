/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Cross-process lock for read-modify-write cycles on shared config files.
 *
 * Two writers (the dev server, the installed app, or two provider mutations
 * landing together) editing the same file would otherwise silently lose the
 * earlier mutation when the later rename wins. A lockfile with exclusive
 * create (`wx`) is atomic on every platform; the holder writes its PID and
 * deletes the file on completion. Stale locks (writer crashed) are broken
 * after a grace period.
 *
 * This is deliberately NOT omp's own lock: omp takes an OS-level `flock(2)` on
 * `${path}.lock` (Linux uses abstract Unix sockets, Windows named mutexes), so
 * the two mechanisms do not interop. The window this leaves — a Kabmo write
 * landing between omp's read and its rename — is bounded by keeping every
 * critical section to a single read-modify-write, and omp re-reads inside its
 * own lock before applying its pending changes.
 */

import fs from 'fs';
import { dirname } from 'path';

const LOCK_TIMEOUT_MS = 3_000;
const LOCK_STALE_MS = 10_000;
const LOCK_RETRY_MS = 25;

/** Run `fn` while holding an exclusive `${configPath}.lock` lease. */
export async function withConfigLock<T>(configPath: string, fn: () => T | Promise<T>): Promise<T> {
  const lockPath = `${configPath}.lock`;
  // The config file may not exist yet (first write) — the lockfile needs its
  // parent dir to exist before exclusive-create can succeed.
  await fs.promises.mkdir(dirname(lockPath), { recursive: true });
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    let handle: fs.promises.FileHandle | null = null;
    try {
      handle = await fs.promises.open(lockPath, 'wx');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      // Held by another process — break it if stale, otherwise wait and retry.
      try {
        if (Date.now() - (await fs.promises.stat(lockPath)).mtimeMs > LOCK_STALE_MS) {
          await fs.promises.unlink(lockPath);
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for ${lockPath} (another process holds the config lock)`);
      }
      await Bun.sleep(LOCK_RETRY_MS);
      continue;
    }
    try {
      await handle.writeFile(String(process.pid));
    } finally {
      await handle.close();
    }
    try {
      return await fn();
    } finally {
      try {
        await fs.promises.unlink(lockPath);
      } catch {
        // Already removed (e.g. by cleanup) — the critical section is done.
      }
    }
  }
}
