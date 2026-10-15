/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Recognising the REPLACEMENT server after an update.
 *
 * The console may only reload once the process serving it has been replaced —
 * reloading earlier fetches the OLD bundle back from the process that is still
 * exiting, and never reloading leaves the user on a stale page. Identity, not a
 * timer, is what "replaced" means, so these cases pin the identity rules:
 * a different pid or start time is the new process, a failed probe is not an
 * answer, and a baseline that could not be read falls back to the uptime
 * evidence the update's own duration makes safe.
 */

import { describe, expect, test } from 'bun:test';

import {
  isReplacement,
  parseServerIdentity,
  readServerIdentity,
  REPLACEMENT_MAX_UPTIME_S,
  waitForServerRestart,
  type ServerIdentity,
} from '@/client/hooks/ui/updates/restart';

const OLD: ServerIdentity = { pid: 100, startedAt: '2026-10-15T00:00:00.000Z', uptime: 3600 };

/** A health responder that hands out one payload per call. */
function healthFetch(payloads: Array<unknown | Error>): { fetch: typeof fetch; calls: () => number } {
  let index = 0;
  const impl = (async () => {
    const next = payloads[Math.min(index, payloads.length - 1)];
    index += 1;
    if (next instanceof Error) throw next;
    if (next === null) return new Response('{}', { status: 503 });
    return Response.json(next);
  }) as unknown as typeof fetch;
  return { fetch: impl, calls: () => index };
}

/** No real waiting: the loop is what is under test, not the clock. */
const noSleep = async (): Promise<void> => {};

describe('parseServerIdentity', () => {
  test('reads the three fields identity is decided from', () => {
    expect(parseServerIdentity({ pid: 42, startedAt: 'x', uptime: 1.5 })).toEqual({ pid: 42, startedAt: 'x', uptime: 1.5 });
  });

  test('a payload naming neither a pid nor a start time identifies nothing', () => {
    // Treating it as an identity would make every later probe look like a match.
    expect(parseServerIdentity({ ok: true })).toBeNull();
    expect(parseServerIdentity(null)).toBeNull();
    expect(parseServerIdentity('nope')).toBeNull();
  });

  test('a start time alone is enough, and a pid alone is enough', () => {
    expect(parseServerIdentity({ startedAt: 'x' })).toEqual({ pid: null, startedAt: 'x', uptime: null });
    expect(parseServerIdentity({ pid: 7 })).toEqual({ pid: 7, startedAt: null, uptime: null });
  });
});

describe('isReplacement', () => {
  test('a different pid is the replacement', () => {
    expect(isReplacement(OLD, { pid: 200, startedAt: OLD.startedAt, uptime: 1 })).toBe(true);
  });

  test('the same pid with a new start time is the replacement', () => {
    // A recycled pid is still a different process, and its start time says so.
    expect(isReplacement(OLD, { pid: 100, startedAt: '2026-10-15T01:00:00.000Z', uptime: 1 })).toBe(true);
  });

  test('the same process answering again is not', () => {
    expect(isReplacement(OLD, { pid: 100, startedAt: OLD.startedAt, uptime: 3700 })).toBe(false);
  });

  test('with no baseline, only a young process counts', () => {
    expect(isReplacement(null, { pid: 1, startedAt: 'x', uptime: REPLACEMENT_MAX_UPTIME_S })).toBe(true);
    expect(isReplacement(null, { pid: 1, startedAt: 'x', uptime: REPLACEMENT_MAX_UPTIME_S + 1 })).toBe(false);
    // No uptime to judge by: never claim a restart happened.
    expect(isReplacement(null, { pid: 1, startedAt: 'x', uptime: null })).toBe(false);
  });
});

describe('readServerIdentity', () => {
  test('a refused or failed probe is null, never an identity', async () => {
    const refused = healthFetch([null]);
    expect(await readServerIdentity({ fetch: refused.fetch })).toBeNull();

    const thrown = healthFetch([new Error('connection refused')]);
    expect(await readServerIdentity({ fetch: thrown.fetch })).toBeNull();
  });

  test('a payload with no identity is null even when the request succeeded', async () => {
    const { fetch: impl } = healthFetch([{ ok: true, version: '1.0.0' }]);
    expect(await readServerIdentity({ fetch: impl })).toBeNull();
  });
});

describe('waitForServerRestart', () => {
  test('resolves once a different process answers, ignoring the old one still serving', async () => {
    const { fetch: impl, calls } = healthFetch([OLD, { pid: 200, startedAt: '2026-10-15T02:00:00.000Z', uptime: 0.4 }]);
    const outcome = await waitForServerRestart(OLD, { fetch: impl, sleep: noSleep });
    expect(outcome).toBe('restarted');
    expect(calls()).toBe(2);
  });

  test('a port that answers nothing yet is not a replacement', async () => {
    // The old server exits and the port is briefly unbound; that gap is the
    // whole reason this polls instead of reloading on the result frame.
    const { fetch: impl } = healthFetch([new Error('refused'), OLD, { pid: 300, startedAt: 'z', uptime: 0.1 }]);
    expect(await waitForServerRestart(OLD, { fetch: impl, sleep: noSleep })).toBe('restarted');
  });

  test('the same process answering forever is a timeout', async () => {
    const { fetch: impl } = healthFetch([OLD]);
    const outcome = await waitForServerRestart(OLD, { fetch: impl, sleep: noSleep, timeoutMs: 0 });
    expect(outcome).toBe('timeout');
  });

  test('an aborted wait reports itself instead of claiming a restart', async () => {
    const controller = new AbortController();
    controller.abort();
    const { fetch: impl } = healthFetch([OLD]);
    expect(await waitForServerRestart(OLD, { fetch: impl, sleep: noSleep, signal: controller.signal })).toBe('aborted');
  });
});
