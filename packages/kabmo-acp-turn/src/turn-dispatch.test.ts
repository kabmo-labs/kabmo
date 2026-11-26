/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `session_busy` retry and the held-input queue, which are one behaviour.
 *
 * ACP has no queue: a second `session/prompt` while one is open cancels the
 * first. So a message sent mid-turn waits (either in `TurnQueue`, because the
 * agent has no steering extension, or in the agent's own window after a cancel),
 * and the dispatch that follows can still meet `-32003 session_busy` while the
 * agent finishes the previous turn. Treating that as a failed turn is what made
 * "Stop, then send again" answer an error the operator could only work around by
 * waiting.
 */

import { describe, expect, test } from 'bun:test';
import { AcpRequestError } from '@kabmo-labs/kabmo-acp-mapper/calls';
import { isSessionBusy, promptWithBusyRetry } from './turn-dispatch';
import { TurnQueue } from './turn-queue';

const busy = () => new AcpRequestError('Session is busy', -32003, { reason: 'session_busy' });

describe('isSessionBusy', () => {
  test('recognises the code with the documented reason', () => {
    expect(isSessionBusy(busy())).toBe(true);
  });

  test('recognises the wording when the reason is absent', () => {
    expect(isSessionBusy(new AcpRequestError('session_busy', -32003))).toBe(true);
  });

  test('another error is not a busy signal', () => {
    expect(isSessionBusy(new AcpRequestError('boom', -32603))).toBe(false);
    expect(isSessionBusy(new Error('session_busy'))).toBe(false);
  });
});

describe('promptWithBusyRetry', () => {
  test('retries a busy refusal and returns the eventual answer', async () => {
    let calls = 0;
    const result = await promptWithBusyRetry(async () => {
      calls += 1;
      if (calls < 3) throw busy();
      return { stopReason: 'end_turn' };
    }, { waitMs: 0, isActive: () => true });
    expect(result).toEqual({ stopReason: 'end_turn' });
    expect(calls).toBe(3);
  });

  test('gives up after the retry budget', async () => {
    let calls = 0;
    await expect(
      promptWithBusyRetry(async () => {
        calls += 1;
        throw busy();
      }, { retries: 2, waitMs: 0, isActive: () => true }),
    ).rejects.toThrow('Session is busy');
    expect(calls).toBe(3);
  });

  test('a cancelled turn stops retrying at once', async () => {
    let calls = 0;
    await expect(
      promptWithBusyRetry(async () => {
        calls += 1;
        throw busy();
      }, { waitMs: 0, isActive: () => false }),
    ).rejects.toThrow('Session is busy');
    expect(calls).toBe(1);
  });

  test('a non-busy failure is never retried', async () => {
    let calls = 0;
    await expect(
      promptWithBusyRetry(async () => {
        calls += 1;
        throw new AcpRequestError('provider down', -32603);
      }, { waitMs: 0, isActive: () => true }),
    ).rejects.toThrow('provider down');
    expect(calls).toBe(1);
  });
});

describe('TurnQueue', () => {
  test('holds inputs in arrival order and reports its size', () => {
    const queue = new TurnQueue();
    queue.push({ message: 'first', images: undefined });
    queue.push({ message: 'second', images: undefined });
    expect(queue.size).toBe(2);
    expect(queue.shift()?.message).toBe('first');
    expect(queue.shift()?.message).toBe('second');
    expect(queue.shift()).toBeUndefined();
  });

  test('clear drops everything a finished session will never dispatch', () => {
    const queue = new TurnQueue();
    queue.push({ message: 'x', images: undefined });
    queue.clear();
    expect(queue.size).toBe(0);
  });
});
