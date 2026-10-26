/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Every temp directory this E2E layer creates, so a run that dies still cleans
 * up after itself.
 *
 * The per-spec teardown (`harness.stop()`, `dispose()`) is correct and is not
 * enough on its own. Three shapes leave a directory behind, and each was
 * measured on this machine (964 dirs, 1.3 GB in `$TMPDIR`):
 *
 *  - **a spec that fails or is retried mid-body** skips every `dispose()` at the
 *    end of that body. Playwright DOES run a fixture's teardown on failure,
 *    which is why `harness.stop()` cleans its own root — but a seeded workspace
 *    or scratch repository is only queued for removal by a `dispose()` the
 *    failed body never reaches. Measured with a probe spec that seeded both and
 *    threw: 2 workspace dirs and 2 repository dirs left behind per attempt.
 *  - **a run interrupted with Ctrl-C** kills the worker, so no teardown runs.
 *  - **a worker killed outright** (SIGKILL, a crash, a CI timeout) runs nothing.
 *
 * So a created directory is registered here the moment it exists, in two
 * buckets that cover different lifetimes:
 *
 *  - the **test scope**, swept by the `_tempRoots` auto fixture after every test
 *    (which is the failure path a `dispose()` cannot reach), and
 *  - the **process scope**, swept on exit and on SIGINT/SIGTERM.
 *
 * A SIGKILL still runs nothing. That case is what `sweepStaleTempDirs` covers at
 * the START of the next run, by age.
 *
 * The prefix is load-bearing: the age sweep deletes by NAME, so it can only ever
 * reach directories this layer made.
 */

import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Every temp name this layer mints starts with this. */
export const E2E_TEMP_PREFIX = 'omc-e2e-';

/**
 * A run older than this cannot still be alive. A full suite is minutes, not
 * hours, and the sweep only runs at the START of a run — so the floor has to be
 * wide enough that a second `playwright test` started beside this one keeps its
 * directories, and narrow enough that yesterday's garbage goes.
 */
const STALE_AGE_MS = 2 * 60 * 60 * 1000;

/** Directories whose owner outlives a test (a compiled fixture binary). */
const processScope = new Set<string>();
/** Directories the CURRENT test created. */
let testScope = new Set<string>();
let exitSweepInstalled = false;

/** How long a removal may keep retrying a lock before the next run takes over. */
const REMOVE_RETRY_MS = 2_000;

/**
 * Remove a directory, tolerating the window where a child still holds it.
 *
 * The same EBUSY/EPERM shape `remove-dir.ts` documents — a seeded workspace the
 * server scanned is a directory the server may still have open — but this one
 * must never throw: it runs in a fixture teardown, and a failed delete there
 * would be reported as the SPEC's failure. A directory still locked after the
 * budget is left to the next run's age sweep.
 */
function removeQuietly(dir: string): void {
  const deadline = Date.now() + REMOVE_RETRY_MS;
  for (;;) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EBUSY' && code !== 'EPERM' && code !== 'ENOTEMPTY') return;
      if (Date.now() >= deadline) return;
      // A synchronous spin: every caller is a teardown with no `await` to
      // yield at, which is the same constraint `remove-dir.ts` works under.
      const until = Date.now() + 50;
      while (Date.now() < until) {
        // Busy-wait: the only portable synchronous pause available here.
      }
    }
  }
}

function sweepProcessScope(): void {
  for (const dir of processScope) removeQuietly(dir);
  processScope.clear();
}

function installExitSweep(): void {
  if (exitSweepInstalled) return;
  exitSweepInstalled = true;
  // `exit` covers a normal end and a failed one. The two signals are what a
  // Ctrl-C and a CI cancellation send.
  process.once('exit', sweepProcessScope);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      sweepProcessScope();
      // Re-raise so the default termination still happens; clearing the
      // handlers first is what keeps this from looping.
      process.removeAllListeners(signal);
      process.kill(process.pid, signal);
    });
  }
}

/**
 * Open a fresh test scope. Called by the `_tempRoots` auto fixture, so it runs
 * before every test body and its sweep runs after it — including on failure and
 * on a retry.
 */
export function beginTempScope(): void {
  installExitSweep();
  // A scope that was never closed (an interrupted run) is swept here rather
  // than forgotten.
  for (const dir of testScope) removeQuietly(dir);
  testScope = new Set();
}

/** Remove everything the test that just ended created. */
export function sweepTempScope(): void {
  for (const dir of testScope) removeQuietly(dir);
  testScope = new Set();
}

/**
 * Register a directory for the CURRENT test's sweep. Idempotent, so a caller may
 * pass the same path twice (a fixture that both owns a root and seeds into it).
 */
export function trackTempDir(dir: string): string {
  installExitSweep();
  testScope.add(dir);
  processScope.add(dir);
  return dir;
}

/**
 * `mkdtempSync` plus registration — the only way a FIXTURE should mint a temp
 * directory. `prefix` is appended to `E2E_TEMP_PREFIX`, so a sweep can always
 * tell whose directory it is.
 */
export function makeTempDir(prefix = ''): string {
  return trackTempDir(mkdtempSync(join(tmpdir(), `${E2E_TEMP_PREFIX}${prefix}`)));
}

/**
 * Stop tracking a directory its owner already removed.
 *
 * `HarnessServer.stop()` is the caller: it deletes its run root itself, after
 * signalling the process group, because a workspace the server scanned is only
 * deletable once IT has released the handles. Leaving the path tracked would
 * make the sweep retry a directory that is gone.
 */
export function untrackTempDir(dir: string): void {
  testScope.delete(dir);
  processScope.delete(dir);
}

/**
 * `mkdtempSync` plus PROCESS-scope registration only — for a directory that must
 * outlive the test that happened to create it.
 *
 * The compiled fake `omp` is the case this exists for: it is built once per run
 * and every later spec uses the same binary, so a test-scoped sweep would delete
 * it out from under the next spec.
 */
export function makeProcessTempDir(prefix = ''): string {
  installExitSweep();
  const dir = mkdtempSync(join(tmpdir(), `${E2E_TEMP_PREFIX}${prefix}`));
  processScope.add(dir);
  return dir;
}

/**
 * Delete leftovers of runs that are no longer alive.
 *
 * Called ONCE per `playwright test` invocation, from `globalSetup`, and never
 * during a run: a live sibling run's directories are younger than the age floor
 * by construction, and a sweep in the middle of a suite would race the very
 * files it is looking at.
 *
 * `root` is injectable because this function DELETES BY NAME, and a unit test
 * that exercised it against the real `$TMPDIR` would sweep every directory a
 * real run left behind — measured: the first version of `temp-root.test.ts` did
 * exactly that, reclaiming 964 directories the developer had not asked it to
 * touch. A test drives it against its own temp root instead.
 *
 * Returns what it removed, so a run can report the reclaim instead of silently
 * deleting gigabytes.
 */
export function sweepStaleTempDirs(
  options: { now?: number; maxAgeMs?: number; root?: string } = {},
): string[] {
  const now = options.now ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? STALE_AGE_MS;
  const root = options.root ?? tmpdir();
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }

  const removed: string[] = [];
  for (const entry of entries) {
    if (!entry.startsWith(E2E_TEMP_PREFIX)) continue;
    const dir = join(root, entry);
    try {
      // mtime, not birthtime: a directory keeps being written while its spec
      // runs, so mtime is what says whether anyone is still using it.
      if (now - statSync(dir).mtimeMs < maxAgeMs) continue;
      rmSync(dir, { recursive: true, force: true });
      removed.push(dir);
    } catch {
      // Locked or already gone: the next run tries again.
    }
  }
  return removed;
}
