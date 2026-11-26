/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A request the client gives up on must be withdrawn from the AGENT.
 *
 * The table's own timeout only freed the pending slot; the agent kept working on
 * a request whose answer nobody would read, and its next prompt then arrived
 * while it was still busy. ACP's `$/cancel_request` is the spec's words for
 * "forget this", and the transport sends it on the request's own id.
 */

import { describe, expect, test, vi } from 'bun:test';
import { PendingCalls } from './calls';

describe('PendingCalls timeouts', () => {
  test('the deadline notifies the agent and rejects the caller', async () => {
    vi.useFakeTimers();
    try {
      const withdrawn: unknown[] = [];
      const pending = new PendingCalls({
        onTimeout: (id, method) => {
          withdrawn.push([id, method]);
        },
      });
      const call = pending.begin('k1', 'session/set_config_option', { sessionId: 's' }, 5);
      vi.advanceTimersByTime(10);
      await expect(call).rejects.toThrow('timed out after 5ms');
      expect(withdrawn).toEqual([['k1', 'session/set_config_option']]);
    } finally {
      vi.useRealTimers();
    }
  });

  test('a settled request is never reported as timed out', async () => {
    vi.useFakeTimers();
    try {
      const withdrawn: unknown[] = [];
      const pending = new PendingCalls({
        onTimeout: (id) => {
          withdrawn.push(id);
        },
      });
      const call = pending.begin('k2', 'session/set_mode', {}, 5);
      expect(pending.settle({ jsonrpc: '2.0', id: 'k2', result: {} })).toBe(true);
      await expect(call).resolves.toEqual({});
      vi.advanceTimersByTime(50);
      expect(withdrawn).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  test('a prompt has no timer at all', async () => {
    const withdrawn: unknown[] = [];
    const pending = new PendingCalls({
      onTimeout: (id) => {
        withdrawn.push(id);
      },
    });
    const call = pending.begin('k3', 'session/prompt', { sessionId: 's' }, 0);
    pending.abandonPrompt('s');
    await expect(call).resolves.toEqual({ stopReason: 'cancelled' });
    expect(withdrawn).toEqual([]);
  });
});
