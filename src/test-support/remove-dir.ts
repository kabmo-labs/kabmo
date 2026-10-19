/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Removing a temp directory, on a host that may not let you.
 *
 * `rmSync(dir, { recursive: true, force: true })` is the idiom everywhere else
 * in this suite, and `force: true` makes it look infallible. It is not: on
 * Windows an open handle makes the delete fail with `EBUSY`, and `force` only
 * suppresses ENOENT. A SQLite connection is exactly such a handle — it stays
 * open until it is closed, and WAL mode keeps `-wal`/`-shm` files beside the
 * database — so a teardown that closes the handle and then deletes the
 * directory races the close on Windows and loses. Measured on the first Windows
 * run: 37 failures, every one of them an `EBUSY: resource busy or locked, rm
 * 'C:\...\Temp\kabmo-…'` thrown from an `afterEach`, which reports the
 * PREVIOUS test as failed and cascades into the rest of the file.
 *
 * Two things make the removal reliable, and both are needed:
 *
 *   1. **Close the database handle first**, through `releaseDb`/the same
 *      `globalThis` slot — no retry helps while a connection is still open.
 *   2. **Retry the delete**, because Windows also fails while a just-closed
 *      handle's last reference is being released by the OS, which is
 *      asynchronous even after `close()` returns. The retry is bounded and
 *      short: a directory that is still locked after a second is a real leak,
 *      and silently ignoring it would hide that.
 *
 * On POSIX the first attempt always succeeds, so this costs one `rmSync` call.
 */

import { rmSync } from 'node:fs';

/** How long to keep retrying a Windows delete before giving up. */
const RETRY_DEADLINE_MS = 5_000;
const RETRY_INTERVAL_MS = 25;

/**
 * Delete a directory, tolerating the transient lock Windows holds on a
 * just-closed handle.
 *
 * Returns true when the directory is gone. Throws only when it is still locked
 * at the deadline, because a temp directory that cannot be removed is a fact
 * worth failing on rather than swallowing — it means a handle outlived its test.
 */
export function removeDir(dir: string): boolean {
  const deadline = Date.now() + RETRY_DEADLINE_MS;
  let attempt = 0;
  for (;;) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // Only a lock is worth retrying; a permission or path error will not
      // resolve itself and should surface immediately.
      if (code !== 'EBUSY' && code !== 'EPERM' && code !== 'ENOTEMPTY') throw error;
      if (Date.now() >= deadline) {
        throw new Error(
          `could not remove ${dir} after ${RETRY_DEADLINE_MS}ms (${code}) — a handle outlived its test`,
          { cause: error },
        );
      }
      // A caller that dropped a connection without closing it leaves the OS to
      // collect it, and only a collection releases the handle. Forcing one after
      // a couple of plain retries is what turns "the object is garbage but not
      // yet finalised" into a deletable file — measured on a Windows runner,
      // where a suite that cleared `globalThis.__kabmoDb` instead of
      // closing it held the tree for the whole retry window.
      if (attempt++ >= 2) Bun.gc(true);
      // A synchronous spin, because the callers are `afterEach` hooks that may
      // not be async. `Bun.sleepSync` is the runtime's own primitive and does
      // not need a promise the hook would have to await.
      Bun.sleepSync(RETRY_INTERVAL_MS);
    }
  }
}
