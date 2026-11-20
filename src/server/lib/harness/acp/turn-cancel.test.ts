/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The grace window after a local Stop.
 *
 * A new prompt (or a second Stop) must free the chain AT ONCE — waiting out the
 * window is what made "Stop, then send" sit for seconds. Only an unanswered
 * cancel with nothing else to do waits.
 */

import { describe, expect, test, vi } from 'bun:test';
import { CancelSettle } from '@/server/lib/harness/acp/turn-cancel';

describe('CancelSettle', () => {
  test('settles once the window closes', () => {
    vi.useFakeTimers();
    try {
      let settled = 0;
      const settle = new CancelSettle(() => {
        settled += 1;
      }, 4_000);
      settle.arm();
      expect(settle.pending()).toBe(true);
      vi.advanceTimersByTime(3_999);
      expect(settled).toBe(0);
      vi.advanceTimersByTime(1);
      expect(settled).toBe(1);
      expect(settle.pending()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  test('flush settles immediately for a prompt that needs the chain', () => {
    vi.useFakeTimers();
    try {
      let settled = 0;
      const settle = new CancelSettle(() => {
        settled += 1;
      }, 4_000);
      settle.arm();
      settle.flush();
      expect(settled).toBe(1);
      vi.advanceTimersByTime(10_000);
      expect(settled).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test('disarm drops the wait without settling', () => {
    vi.useFakeTimers();
    try {
      let settled = 0;
      const settle = new CancelSettle(() => {
        settled += 1;
      }, 4_000);
      settle.arm();
      settle.disarm();
      vi.advanceTimersByTime(10_000);
      expect(settled).toBe(0);
      expect(settle.pending()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  test('flush on an idle window is a no-op', () => {
    let settled = 0;
    const settle = new CancelSettle(() => {
      settled += 1;
    });
    settle.flush();
    expect(settled).toBe(0);
  });
});
