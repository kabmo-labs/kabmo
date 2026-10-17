/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Removing a temp directory a spec created, on a host that may not let you.
 *
 * `rmSync(dir, { recursive: true, force: true })` looks infallible and is not:
 * `force` only suppresses ENOENT, and on Windows an open handle makes the delete
 * fail with `EBUSY`. Every fixture here is a directory the SERVER under test may
 * still hold open — a workspace folder it scanned, a git repository it read — so
 * the teardown races the server's own release of those handles. Measured on the
 * Windows leg: every spec that disposed a workspace reported `EBUSY: resource
 * busy or locked, rmdir '…\omc-e2e-ws-…'`, and because the throw happened in a
 * `dispose()` inside the spec body it was reported as that spec's failure.
 *
 * The retry is bounded: a directory still locked after a couple of seconds is a
 * real leak, and failing on it is more useful than swallowing it.
 *
 * This is a separate copy from `src/test-support/remove-dir.ts` on purpose: the
 * E2E layer runs under Playwright/Node, outside the app's `src/` program, so it
 * cannot import through the `@/` alias and must not pull Bun-only APIs in.
 */

import { rmSync } from 'node:fs';

const RETRY_DEADLINE_MS = 5_000;
const RETRY_INTERVAL_MS = 50;

/** Delete a directory, tolerating the lock Windows holds on a closing handle. */
export function removeDirWhenFree(dir: string): void {
  const deadline = Date.now() + RETRY_DEADLINE_MS;
  for (;;) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EBUSY' && code !== 'EPERM' && code !== 'ENOTEMPTY') throw error;
      if (Date.now() >= deadline) {
        throw new Error(`could not remove ${dir} after ${RETRY_DEADLINE_MS}ms (${code})`, { cause: error });
      }
      // A synchronous spin: every caller is a fixture's `dispose()`, which runs
      // inside a spec body and has no `await` to yield at.
      const until = Date.now() + RETRY_INTERVAL_MS;
      while (Date.now() < until) {
        // Busy-wait: the only portable synchronous pause available here.
      }
    }
  }
}
