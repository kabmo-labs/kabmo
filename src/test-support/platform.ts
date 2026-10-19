/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Which suites can run on which platform, as one import instead of a literal
 * `process.platform === 'win32'` in every file.
 *
 * The Kabmo runs on Windows (the CLI, the omp child, the terminal and the
 * process probes all carry win32 branches), but a real part of the test suite
 * cannot: a POSIX-only suite is one that reaches for `/bin/sh`, writes a
 * `#!/bin/sh` stub and chmods it executable, opens a `Bun.Terminal`, or takes an
 * `flock(2)`. On Windows each of those fails for a reason that has nothing to do
 * with the code under test —
 *
 *   - `Bun.spawn(['/bin/sh', …])` is `ENOENT`: there is no `/bin/sh`.
 *   - a file whose only "executability" is a shebang line and mode `0o755` is not
 *     a program Windows can start; `CreateProcess` needs a real executable.
 *   - `Bun.Terminal` (the PTY) is not implemented on Windows, so `new
 *     Bun.Terminal(…)` throws.
 *   - `flock(2)` has no Windows equivalent, and `symlinkSync` needs a privilege a
 *     default runner does not have.
 *
 * — and the honest answer is to skip, named, rather than to weaken the assertion
 * into something that passes on both platforms while proving nothing. A suite
 * that skips is visible in the run's output; a suite that silently asserted
 * nothing is not.
 *
 * This is deliberately a small module rather than an inline ternary per file:
 * the same three names in thirty files is thirty chances to write
 * `describe.skip` where `describe` was meant, which is how a suite stops running
 * on the platform it was written for. `platform.test.ts` pins the mapping
 * against the running platform.
 *
 * Use `describePosix`/`testPosix` for a suite that is POSIX-ONLY. A suite that
 * has both kinds of case should NOT be skipped wholesale — keep the portable
 * cases running and guard only the POSIX ones, so the Windows leg still covers
 * whatever it can.
 */

import { describe, test } from 'bun:test';

/** True on the platform this run is executing on. */
export const isWindows = process.platform === 'win32';

/** `describe`, skipped on Windows. */
export const describePosix = isWindows ? describe.skip : describe;

/** `test`, skipped on Windows. */
export const testPosix = isWindows ? test.skip : test;
