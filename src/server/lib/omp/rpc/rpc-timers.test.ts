/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The two clock-owned guards of a live omp session, driven with fake timers.
 *
 * Both decisions are callbacks because only the session wrapper can answer
 * "is it still busy?" / "did the dispatch settle?"; what is pinned here is the
 * clock contract around that answer:
 *
 *  - `IdleReaper` defers its deadline on every frame but COALESCES re-arms
 *    within 5 s (a streaming turn emits hundreds of frames a second), and
 *    re-arms from now when the idle callback says the session turned busy.
 *  - `AgentStartWatchdog` fires only for a dispatch that never opened a turn:
 *    a live stream outranks the deadline, and `settleIfDone` must cancel so a
 *    stale callback cannot re-read flags a later dispatch re-armed.
 */

import { describe, expect, test, vi } from 'bun:test';

import { IdleReaper } from '@/server/lib/omp/rpc/idle-reaper';
import { AgentStartWatchdog, type AgentStartWatchdogHost } from '@/server/lib/omp/rpc/agent-start-watchdog';

describe('IdleReaper', () => {
  test('fires the idle callback once the window elapses', () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const reaper = new IdleReaper(10_000, () => {
        calls++;
        return true;
      });
      expect(reaper.timeoutMs).toBe(10_000);
      reaper.reset();
      vi.advanceTimersByTime(9_999);
      expect(calls).toBe(0);
      vi.advanceTimersByTime(1);
      expect(calls).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test('re-arms from now when the idle callback reports the session is busy again', () => {
    vi.useFakeTimers();
    try {
      const answers = [false, true];
      let calls = 0;
      const reaper = new IdleReaper(10_000, () => {
        calls++;
        return answers.shift() ?? true;
      });
      reaper.reset();
      vi.advanceTimersByTime(10_000);
      // First fire said "busy" → the timer re-armed from now, so it has not
      // fired again yet at the same instant.
      expect(calls).toBe(1);
      vi.advanceTimersByTime(10_000);
      expect(calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  test('coalesces re-arms within the 5 s window so a frame burst moves the deadline once', () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const reaper = new IdleReaper(10_000, () => {
        calls++;
        return true;
      });
      reaper.reset();
      vi.advanceTimersByTime(1_000);
      reaper.reset(); // inside COALESCE_MS → ignored, deadline stays at t=10s
      vi.advanceTimersByTime(9_000);
      expect(calls).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test('force bypasses the coalescing window', () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const reaper = new IdleReaper(10_000, () => {
        calls++;
        return true;
      });
      reaper.reset();
      vi.advanceTimersByTime(1_000);
      reaper.reset(true); // deadline moves to t=11s
      vi.advanceTimersByTime(9_000);
      expect(calls).toBe(0);
      vi.advanceTimersByTime(1_000);
      expect(calls).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test('stop cancels without reclaiming', () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const reaper = new IdleReaper(10_000, () => {
        calls++;
        return true;
      });
      reaper.reset();
      reaper.stop();
      vi.advanceTimersByTime(60_000);
      expect(calls).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test('a reset after stop arms a fresh window', () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const reaper = new IdleReaper(10_000, () => {
        calls++;
        return true;
      });
      reaper.reset();
      reaper.stop();
      reaper.reset();
      vi.advanceTimersByTime(10_000);
      expect(calls).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

function watchdogHost(overrides: Partial<AgentStartWatchdogHost> = {}): AgentStartWatchdogHost {
  return {
    awaitingAgentStart: true,
    awaitingAgentStartDeadline: Date.now() + 10_000,
    streaming: false,
    sessionId: 'session-1',
    ...overrides,
  };
}

describe('AgentStartWatchdog', () => {
  test('fires at the armed deadline when nothing settles the dispatch', () => {
    vi.useFakeTimers();
    try {
      let expired = 0;
      const host = watchdogHost();
      const watchdog = new AgentStartWatchdog(host, () => expired++);
      watchdog.arm();
      vi.advanceTimersByTime(9_999);
      expect(expired).toBe(0);
      vi.advanceTimersByTime(1);
      expect(expired).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test('is a no-op when no dispatch is awaiting a turn', () => {
    vi.useFakeTimers();
    try {
      let expired = 0;
      const host = watchdogHost({ awaitingAgentStart: false });
      const watchdog = new AgentStartWatchdog(host, () => expired++);
      watchdog.arm();
      vi.advanceTimersByTime(60_000);
      expect(expired).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test('is a no-op when the session id is not yet known', () => {
    vi.useFakeTimers();
    try {
      let expired = 0;
      const watchdog = new AgentStartWatchdog(watchdogHost({ sessionId: '' }), () => expired++);
      watchdog.arm();
      vi.advanceTimersByTime(60_000);
      expect(expired).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test('does not fire when a frame settled the dispatch while it waited', () => {
    vi.useFakeTimers();
    try {
      let expired = 0;
      const host = watchdogHost();
      const watchdog = new AgentStartWatchdog(host, () => expired++);
      watchdog.arm();
      host.awaitingAgentStart = false; // agent_start / prompt_result arrived
      vi.advanceTimersByTime(60_000);
      expect(expired).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test('a live stream outranks a stale deadline', () => {
    vi.useFakeTimers();
    try {
      let expired = 0;
      const host = watchdogHost();
      const watchdog = new AgentStartWatchdog(host, () => expired++);
      watchdog.arm();
      host.streaming = true;
      vi.advanceTimersByTime(60_000);
      expect(expired).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test('a past deadline fires on the next tick rather than a negative delay', () => {
    vi.useFakeTimers();
    try {
      let expired = 0;
      const host = watchdogHost({ awaitingAgentStartDeadline: Date.now() - 5_000 });
      const watchdog = new AgentStartWatchdog(host, () => expired++);
      watchdog.arm();
      vi.advanceTimersByTime(0);
      expect(expired).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test('settleIfDone cancels the armed timer when the dispatch settled', () => {
    vi.useFakeTimers();
    try {
      let expired = 0;
      const host = watchdogHost();
      const watchdog = new AgentStartWatchdog(host, () => expired++);
      watchdog.arm();
      host.awaitingAgentStart = false;
      watchdog.settleIfDone();
      vi.advanceTimersByTime(60_000);
      expect(expired).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test('settleIfDone leaves an unsettled dispatch armed', () => {
    vi.useFakeTimers();
    try {
      let expired = 0;
      const host = watchdogHost();
      const watchdog = new AgentStartWatchdog(host, () => expired++);
      watchdog.arm();
      watchdog.settleIfDone();
      vi.advanceTimersByTime(10_000);
      expect(expired).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test('stop cancels without firing', () => {
    vi.useFakeTimers();
    try {
      let expired = 0;
      const watchdog = new AgentStartWatchdog(watchdogHost(), () => expired++);
      watchdog.arm();
      watchdog.stop();
      vi.advanceTimersByTime(60_000);
      expect(expired).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test('re-arming replaces the previous deadline with the newest one', () => {
    vi.useFakeTimers();
    try {
      let expired = 0;
      const host = watchdogHost();
      const watchdog = new AgentStartWatchdog(host, () => expired++);
      watchdog.arm();
      vi.advanceTimersByTime(5_000);
      host.awaitingAgentStartDeadline = Date.now() + 10_000;
      watchdog.arm();
      vi.advanceTimersByTime(10_000);
      expect(expired).toBe(1);
      vi.advanceTimersByTime(60_000);
      expect(expired).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
