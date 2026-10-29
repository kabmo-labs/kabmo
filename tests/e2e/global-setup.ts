/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Reclaim what a killed run left behind.
 *
 * Every other teardown path in this layer runs inside a live worker: the
 * `_tempRoots` fixture covers a failing or retried test, and the process-exit
 * and signal hooks in `fixtures/temp-root.ts` cover a normal end and a Ctrl-C.
 * A SIGKILLed worker — a CI timeout, an OOM, a killed terminal — runs none of
 * them, and those directories then sit in `$TMPDIR` for good: measured on this
 * machine, 964 directories and 1.3 GB, accumulated over four days of runs.
 *
 * This runs ONCE before the first worker, which is the only moment a sweep can
 * be safe: a directory a live run owns is younger than the age floor, so a
 * second `playwright test` started beside this one keeps everything it is
 * using.
 */

import { pruneStubCache } from '../../src/test-support/stub-cache';
import { sweepStaleTempDirs } from './fixtures/temp-root';

export default function globalSetup(): void {
  const removed = sweepStaleTempDirs();
  if (removed.length > 0) {
    // Reported rather than silent: a run that reclaims gigabytes should say so,
    // and the line is the only evidence the sweep still works.
    console.log(`e2e: removed ${removed.length} temp director${removed.length === 1 ? 'y' : 'ies'} from earlier runs`);
  }

  // The compiled-fixture cache is not `omc-e2e-`-prefixed and is not a test
  // temp root: it is shared with `bun test` and meant to be reused, so the age
  // sweep above can never reach it. It still has to be reclaimed when a stub's
  // source changed, or the old ~90 MB binary sits there forever.
  const staleBins = pruneStubCache();
  if (staleBins.length > 0) {
    console.log(`e2e: removed ${staleBins.length} stale compiled fixture${staleBins.length === 1 ? '' : 's'}`);
  }
}
