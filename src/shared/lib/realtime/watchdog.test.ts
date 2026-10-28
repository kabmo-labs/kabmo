/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The watchdog's decision, pinned directly.
 *
 * Every branch here answers a timing question, and a timing case driven through
 * real timers is a test of the clock rather than of the rule. The driver that
 * calls this is `resume.ts`; the interval it owns is covered separately in
 * `connection.test.ts`, through the public client.
 *
 * The reported failure this exists for: an Android WebView that was backgrounded
 * fires no `visibilitychange` on return, and a socket the server's 30s heartbeat
 * reaped while the page was frozen produces no `close` — `readyState` still says
 * OPEN. The channel sat on a corpse until a page reload.
 */

import { describe, expect, test } from 'bun:test';

import {
  FREEZE_DETECT_MS,
  IDLE_PROBE_AFTER_MS,
  LIVENESS_TICK_MS,
  watchdogAction,
} from '@/shared/lib/realtime/watchdog';

/** A healthy tick: on schedule, traffic just arrived, page visible and open. */
const HEALTHY = {
  sinceTick: LIVENESS_TICK_MS,
  sinceInbound: LIVENESS_TICK_MS,
  hidden: false,
  open: true,
  wanted: true,
} as const;

describe('watchdogAction', () => {
  test('a healthy connection asks for nothing', () => {
    expect(watchdogAction(HEALTHY)).toBeNull();
  });

  test('a late tick is a freeze, and waking beats probing', () => {
    // The page was suspended: the clock moved, our interval did not. This is the
    // only resume signal a backgrounded Android WebView leaves behind.
    expect(watchdogAction({ ...HEALTHY, sinceTick: FREEZE_DETECT_MS + 1 })).toBe('wake');
    // Even with the socket silent for longer still, waking is the stronger
    // repair: it re-dials a socket that is gone, while a probe can only question
    // one the browser still believes in.
    expect(
      watchdogAction({ ...HEALTHY, sinceTick: FREEZE_DETECT_MS + 1, sinceInbound: IDLE_PROBE_AFTER_MS * 4 }),
    ).toBe('wake');
  });

  test('a late tick on a HIDDEN page is throttling, not a freeze', () => {
    // A hidden tab is legitimately throttled to about a tick a minute. Reading
    // that as a freeze would re-dial on every throttled tick for a page nobody is
    // looking at.
    expect(
      watchdogAction({ ...HEALTHY, hidden: true, sinceTick: LIVENESS_TICK_MS * 20 }),
    ).toBeNull();
  });

  test('silence on a visible open socket is probed', () => {
    expect(watchdogAction({ ...HEALTHY, sinceInbound: IDLE_PROBE_AFTER_MS })).toBe('probe');
  });

  test('a probe fires below the server heartbeat, not after it', () => {
    // The server reaps an unanswered connection at 30s. Probing later would only
    // ever discover a connection already torn down.
    expect(IDLE_PROBE_AFTER_MS).toBeLessThan(30_000);
    expect(FREEZE_DETECT_MS).toBeGreaterThan(LIVENESS_TICK_MS);
  });

  test('silence on a hidden page is still probed', () => {
    // Deliberately not gated on visibility: a connection that died while the
    // user was in another app is repaired before they come back, rather than
    // after. `wake` is what needs the page to be visible.
    expect(
      watchdogAction({ ...HEALTHY, hidden: true, sinceInbound: IDLE_PROBE_AFTER_MS + 1 }),
    ).toBe('probe');
  });

  test('a closed socket is never probed', () => {
    // `wake` owns the re-dial path; a probe has nothing to send on.
    expect(watchdogAction({ ...HEALTHY, open: false, sinceInbound: IDLE_PROBE_AFTER_MS * 3 })).toBeNull();
  });

  test('nothing happens once every subscription is released', () => {
    expect(
      watchdogAction({ ...HEALTHY, wanted: false, sinceTick: FREEZE_DETECT_MS * 3, sinceInbound: IDLE_PROBE_AFTER_MS * 3 }),
    ).toBeNull();
  });

  test('a tick one millisecond under either threshold is not enough', () => {
    expect(watchdogAction({ ...HEALTHY, sinceTick: FREEZE_DETECT_MS })).toBeNull();
    expect(watchdogAction({ ...HEALTHY, sinceInbound: IDLE_PROBE_AFTER_MS - 1 })).toBeNull();
  });
});
