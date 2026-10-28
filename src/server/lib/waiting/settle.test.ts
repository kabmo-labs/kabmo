/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The dependency check, which is the whole "is it finished yet?" rule.
 *
 * Every case below is a state a real session reaches and a condition whose
 * absence shipped a bug of its own: `finish` written before the turn's
 * bookkeeping settles, a follow-up queued at the run end, a delivery armed
 * 500 ms out, and a row whose one-second clock is younger than the decision.
 */

import { describe, expect, test } from 'bun:test';
import { dependencyVerdict, SETTLE_GRACE_MS } from '@/server/lib/waiting/settle';

const NOW = 1_800_000_000_000;
const OLD = NOW - SETTLE_GRACE_MS - 5_000;

const settled = { busy: false, queued: false, delivering: false };

describe('dependencyVerdict', () => {
  test('a session still streaming is never settled', () => {
    expect(dependencyVerdict({ ...settled, stream: { status: 'stream', updatedAt: OLD } }, NOW)).toEqual({
      settled: false,
      reason: 'streaming',
    });
  });

  test('a finished run with nothing pending is settled', () => {
    expect(dependencyVerdict({ ...settled, stream: { status: 'finish', updatedAt: OLD } }, NOW)).toEqual({
      settled: true,
      reason: null,
    });
  });

  // Stop is a finish for the purposes of the wait: the user ended the run, and a
  // dependent prompt has no reason to wait for a turn that will never resume.
  test('an aborted run counts as finished', () => {
    expect(dependencyVerdict({ ...settled, stream: { status: 'abort', updatedAt: OLD } }, NOW).settled).toBe(true);
  });

  test('a session with no stream row at all counts as finished', () => {
    expect(dependencyVerdict({ ...settled, stream: undefined }, NOW)).toEqual({ settled: true, reason: 'no-row' });
  });

  // The three "there is still work here" conditions, each measured against a run
  // whose status row already says finish.
  test('a live wrapper that is still busy blocks the release', () => {
    expect(dependencyVerdict({ ...settled, busy: true, stream: { status: 'finish', updatedAt: OLD } }, NOW)).toEqual({
      settled: false,
      reason: 'busy',
    });
  });

  test('a queued follow-up blocks the release', () => {
    expect(dependencyVerdict({ ...settled, queued: true, stream: { status: 'finish', updatedAt: OLD } }, NOW)).toEqual({
      settled: false,
      reason: 'queued',
    });
  });

  test('an armed delivery slot blocks the release', () => {
    expect(
      dependencyVerdict({ ...settled, delivering: true, stream: { status: 'finish', updatedAt: OLD } }, NOW),
    ).toEqual({ settled: false, reason: 'delivering' });
  });

  test('a status row younger than the grace window is not yet trusted', () => {
    expect(
      dependencyVerdict(
        { ...settled, stream: { status: 'finish', updatedAt: NOW - SETTLE_GRACE_MS + 1 } },
        NOW,
      ),
    ).toEqual({ settled: false, reason: 'grace' });
  });

  // The clock is optional: a row written before the column was read has none,
  // and refusing to release on that would strand every prompt created against it.
  test('a row with no clock is settled rather than held forever', () => {
    expect(dependencyVerdict({ ...settled, stream: { status: 'finish', updatedAt: null } }, NOW).settled).toBe(true);
  });
});
