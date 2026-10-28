/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The follow-up queue must never wedge.
 *
 * A scheduled delivery whose timer never runs (a `bun --hot` module
 * re-evaluation discards the pending closure; a wedged event loop drops the
 * callback) used to poison the session permanently: the in-flight guard
 * early-returned on the leftover entry, so no later trigger — another
 * agent_end, a tab's mount nudge — could ever schedule again. The queue simply
 * stopped draining, with no error anywhere. Observed live: a dev server whose
 * `setTimeout` from request handlers had stopped firing left every queued
 * follow-up stranded, while a freshly started server delivered the identical
 * item correctly.
 *
 * This file covers the SCHEDULING contract — when a delivery runs, when it
 * defers, and how it recovers. What a dispatch actually sends lives in
 * `delivery-dispatch.server.test.ts`; both share `delivery-harness.ts`.
 */

import { afterAll, afterEach, beforeAll, describe, expect, jest, mock, test } from 'bun:test';
import {
  beginQueueTest,
  flush,
  installStoreMock,
  makeHost,
  queue,
  queueItem,
  restoreStore,
  scheduleQueueDelivery,
  settleDelivery,
} from '@/server/lib/queue/delivery-harness';

beforeAll(() => {
  installStoreMock();
});

afterEach(() => {
  jest.useRealTimers();
});

afterAll(() => {
  mock.restore();
  // Hand the real SQLite store back: `mock.module` would otherwise stay
  // registered for every suite that runs after this file.
  restoreStore();
});

describe('queue delivery scheduling', () => {
  test('a busy session holds the item instead of sending it', async () => {
    const sessionId = beginQueueTest();
    queue.set(sessionId, [queueItem('held')]);
    const { host, sent } = makeHost(sessionId);
    host.isBusy = () => true;

    await settleDelivery(host);

    expect(sent).toEqual([]);
    expect(queue.get(sessionId)?.length).toBe(1);
  });

  // The regression this file exists for: a delivery that finds the session busy
  // at its tick used to return and stay returned. The run-end that scheduled it
  // is the LAST trigger that run produces, so nothing re-armed it — the queue
  // stalled with no error, and even a manual nudge could not recover it because
  // `scheduleQueueDelivery` early-returns while a fresh entry sits in the map.
  test('a delivery that finds the session busy retries until it goes idle', async () => {
    const sessionId = beginQueueTest();
    queue.set(sessionId, [queueItem('held then sent')]);
    const { host, sent } = makeHost(sessionId);
    let busy = true;
    host.isBusy = () => busy;

    await settleDelivery(host);

    // Held at the first tick — the item must survive untouched.
    expect(sent).toEqual([]);
    expect(queue.get(sessionId)?.length).toBe(1);

    // Still busy across several retry intervals: the item must not be lost.
    jest.advanceTimersByTime(6_000);
    await flush();
    expect(sent).toEqual([]);
    expect(queue.get(sessionId)?.length).toBe(1);

    // The session frees up on its own (the subagent finished, the dialog was
    // answered). No new agent_end arrives; the retry is the only thing that can
    // deliver it.
    busy = false;
    jest.advanceTimersByTime(2_000);
    await flush();

    expect(sent.filter((c) => c.type === 'prompt').length).toBe(1);
    expect(queue.get(sessionId)).toEqual([]);
  });

  test('a retry stops arming once the queue has emptied elsewhere', async () => {
    const sessionId = beginQueueTest();
    queue.set(sessionId, [queueItem('taken by another tab')]);
    const { host, sent } = makeHost(sessionId);
    host.isBusy = () => true;

    await settleDelivery(host);

    // Another tab claimed it while this session was busy.
    queue.set(sessionId, []);
    jest.advanceTimersByTime(2_000);
    await flush();

    // No poll loop is left behind: the host is never asked to deliver again.
    const probesAfterEmpty = sent.length;
    jest.advanceTimersByTime(60_000);
    await flush();
    expect(sent.length).toBe(probesAfterEmpty);
  });

  test('a failed dispatch returns the item to the head', async () => {
    const sessionId = beginQueueTest();
    queue.set(sessionId, [queueItem('retry me')]);
    const { host } = makeHost(sessionId);
    host.send = async () => {
      throw new Error('rpc down');
    };

    await settleDelivery(host);

    expect(queue.get(sessionId)?.map((i) => i.text)).toEqual(['retry me']);
  });

  // A failed dispatch re-arms, so a transient RPC failure drains on its own
  // rather than waiting for a run end that may never come.
  test('a failed dispatch retries and delivers once the send recovers', async () => {
    const sessionId = beginQueueTest();
    queue.set(sessionId, [queueItem('transient')]);
    const { host, sent } = makeHost(sessionId);
    let failing = true;
    host.send = async (command) => {
      if (failing) throw new Error('rpc down');
      sent.push(command);
      return {};
    };

    await settleDelivery(host);
    expect(sent).toEqual([]);

    failing = false;
    jest.advanceTimersByTime(2_000);
    await flush();

    expect(sent.filter((c) => c.type === 'prompt').length).toBe(1);
    expect(queue.get(sessionId)).toEqual([]);
  });

  test('repeated triggers deliver the head exactly once', async () => {
    const sessionId = beginQueueTest();
    queue.set(sessionId, [queueItem('once')]);
    const { host, sent } = makeHost(sessionId);

    // Three triggers land before the settle delay elapses — the head must be
    // claimed once, not once per trigger.
    scheduleQueueDelivery(host);
    scheduleQueueDelivery(host);
    scheduleQueueDelivery(host);
    jest.advanceTimersByTime(600);
    await flush();

    expect(sent.filter((c) => c.type === 'prompt').length).toBe(1);
    expect(queue.get(sessionId)).toEqual([]);
  });

  test('a lost timer delays the queue instead of wedging it', async () => {
    const sessionId = beginQueueTest();
    queue.set(sessionId, [queueItem('recovered')]);
    const { host, sent } = makeHost(sessionId);

    // A delivery was scheduled but its callback never ran — the entry is left
    // behind, which is exactly what a hot-reloaded module or a wedged event
    // loop leaves. `clearAllTimers` drops the pending callback WITHOUT running
    // it, so the bookkeeping outlives the timer.
    scheduleQueueDelivery(host);
    jest.clearAllTimers();
    jest.advanceTimersByTime(600);
    await flush();
    expect(sent).toEqual([]);

    // Inside the staleness bound a new trigger still defers to the pending
    // entry: the head must not be double-booked.
    jest.advanceTimersByTime(1000);
    scheduleQueueDelivery(host);
    jest.advanceTimersByTime(600);
    await flush();
    expect(sent).toEqual([]);

    // Past it, a later trigger recovers the queue rather than giving up.
    jest.advanceTimersByTime(5000);
    scheduleQueueDelivery(host);
    jest.advanceTimersByTime(600);
    await flush();

    expect(sent.filter((c) => c.type === 'prompt').length).toBe(1);
    expect(queue.get(sessionId)).toEqual([]);
  });
});
