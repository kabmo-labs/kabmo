/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The platform-skip helper's mapping, pinned against the RUNNING platform.
 *
 * This is a one-line module and it is still worth a test, because both ways it
 * can be wrong are silent and both stop a suite from running:
 *
 *   - inverted, so a POSIX suite is skipped on the platform it was written for
 *     and the Windows leg runs cases that cannot pass there;
 *   - `describePosix` bound to `describe` instead of `describe.skip` (or vice
 *     versa), which turns "skipped, with a reason" into either a hard failure or
 *     a suite that quietly stops covering anything.
 *
 * Neither shows up as a failure anywhere else: a skipped test reports as
 * skipped, which is what a passing run looks like.
 */

import { describe, expect, test } from 'bun:test';
import { describePosix, isWindows, testPosix } from '@/test-support/platform';

describe('the platform helper', () => {
  test('`isWindows` is the running platform, not a constant', () => {
    expect(isWindows).toBe(process.platform === 'win32');
  });

  test('`describePosix` is `describe` on POSIX and `describe.skip` on Windows', () => {
    // Identity, not behaviour: the whole point of the export is WHICH of the two
    // it is, and a behavioural probe (does the block run?) cannot tell a skipped
    // suite from an empty one.
    const expected = isWindows ? describe.skip : describe;
    expect(describePosix).toBe(expected);
  });

  test('`testPosix` is `test` on POSIX and `test.skip` on Windows', () => {
    const expected = isWindows ? test.skip : test;
    expect(testPosix).toBe(expected);
  });

  test('the two guards agree with each other', () => {
    // A file that guarded its describes and its tests from different sources is
    // how one suite ends up half-skipped.
    expect(describePosix === describe).toBe(testPosix === test);
  });
});
