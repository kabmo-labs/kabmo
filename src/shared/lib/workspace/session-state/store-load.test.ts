/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The blob-arrival half of the session-state store: what wins when a stored
 * blob lands, and what a read must not overwrite.
 *
 * Split from `store.test.ts` for the per-file ceiling. The contract pinned here
 * is the one that produced two measured bugs:
 *
 *  - A response is served from a snapshot taken when the request arrived, so a
 *    key written WHILE the read was in flight is newer — even once its own
 *    persist landed and cleared the dirty flag. Without the write counter, a
 *    file opened during the page's first `/state` read came back with
 *    `layout.openedFiles` gone.
 *  - A key CLEARED in that window must not be resurrected by a response that
 *    still carries it.
 */

import { describe, expect, test } from 'bun:test';

import {
  clearSessionKey,
  flushSession,
  getSessionValue,
  hydrateSession,
  loadSession,
  setSessionKey,
} from '@/shared/lib/workspace/session-state/store';
import { counter, follow, installStoreTeardown, use } from '@/shared/lib/workspace/session-state/harness.test-util';

installStoreTeardown();

describe('session-state store: blob arrival (loadSession)', () => {
  function stubWindow(): void {
    Reflect.set(globalThis, 'window', {});
  }

  function stubFetch(response: unknown): void {
    Reflect.set(globalThis, 'fetch', async () => response);
  }

  /**
   * A fetch stub that HOLDS the blob read and lets writes through.
   *
   * Gating every call deadlocks the case: the write's own persist is a `POST`
   * to the same path, and a stub that awaits the gate for both means the flush
   * can never complete while the read is held.
   */
  function gateReads(state: unknown): () => void {
    const { promise: gate, resolve } = Promise.withResolvers<void>();
    Reflect.set(globalThis, 'fetch', async (_url: string, init?: { method?: string }) => {
      if (init?.method === 'POST') return { ok: true, json: async () => ({}) };
      await gate;
      return { ok: true, json: async () => ({ state }) };
    });
    return resolve;
  }

  test('a clean session adopts the stored blob and notifies', async () => {
    const id = use('load-clean');
    stubWindow();
    stubFetch({ ok: true, json: async () => ({ state: { a: 1, b: 2 } }) });
    const probe = counter();
    follow(id, null, probe.listener);

    await loadSession(id);
    expect<number | undefined>(getSessionValue(id, 'a')).toBe(1);
    expect<string | number | boolean | Record<string, unknown> | unknown[] | null | undefined>(getSessionValue(id, 'b')).toBe(2);
    expect(probe.calls).toBe(1);
  });

  test('a dirty session keeps its local writes over the blob', async () => {
    const id = use('load-dirty');
    stubWindow();
    setSessionKey(id, 'a', 99);
    stubFetch({ ok: true, json: async () => ({ state: { a: 1, b: 2 } }) });

    await loadSession(id);
    expect<string | number | boolean | Record<string, unknown> | unknown[] | null | undefined>(getSessionValue(id, 'a')).toBe(99);
    expect<string | number | boolean | Record<string, unknown> | unknown[] | null | undefined>(getSessionValue(id, 'b')).toBe(2);
  });

  test('a non-ok response leaves the cache untouched but still notifies', async () => {
    const id = use('load-error');
    stubWindow();
    stubFetch({ ok: false, json: async () => ({}) });
    const probe = counter();
    follow(id, null, probe.listener);

    await loadSession(id);
    expect(getSessionValue(id, 'a')).toBeUndefined();
    expect(probe.calls).toBe(1);
  });

  test('a rejected fetch is swallowed and notifies', async () => {
    const id = use('load-throw');
    stubWindow();
    Reflect.set(globalThis, 'fetch', async () => {
      throw new Error('offline');
    });
    const probe = counter();
    follow(id, null, probe.listener);

    // The store logs the failure; keep the expected warning out of the run log.
    const warn = console.warn;
    console.warn = () => {};
    try {
      await loadSession(id);
    } finally {
      console.warn = warn;
    }
    expect(getSessionValue(id, 'a')).toBeUndefined();
    expect(probe.calls).toBe(1);
  });

  test('loadSession without a window returns early: no fetch, no notify', async () => {
    const id = use('load-nowindow');
    // Removed for the case and put back after it: another file's hook can have
    // installed one while this file runs, and leaving it missing would break
    // whichever case follows.
    const hadWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Reflect.deleteProperty(globalThis, 'window');
    let fetched = false;
    Reflect.set(globalThis, 'fetch', async () => {
      fetched = true;
      throw new Error('must not be called');
    });
    try {
      const probe = counter();
      follow(id, null, probe.listener);
      await loadSession(id);
      expect(fetched).toBe(false);
      expect(probe.calls).toBe(0);
    } finally {
      if (hadWindow) Object.defineProperty(globalThis, 'window', hadWindow);
      Reflect.set(globalThis, 'fetch', Bun.fetch);
    }
  });

  /**
   * A write that lands WHILE the read is in flight must survive the response,
   * even when its own persist already landed (so the dirty flag is clear).
   *
   * This is the race behind a rare e2e failure: the page's first `/state` read
   * is served from a snapshot taken before the click, the click writes and
   * persists, the persist clears `dirty`, and the late response was then adopted
   * wholesale — `layout.openedFiles` came back empty and the editor drew
   * "Select a file to open" over the file the user had just opened.
   */
  test('a key written during the read wins over the response, even once it persisted', async () => {
    const id = use('load-inflight');
    stubWindow();
    const resolve = gateReads({ a: 1, b: 2 });

    const pending = loadSession(id);
    // The write and its persist both land while the response is held.
    setSessionKey(id, 'a', 99);
    await flushSession(id);
    resolve();
    await pending;

    expect<number | undefined>(getSessionValue(id, 'a')).toBe(99);
    // The rest of the blob is still adopted: only the written key is protected.
    expect<number | undefined>(getSessionValue(id, 'b')).toBe(2);
  });

  test('a key untouched during the read is adopted from the response', async () => {
    const id = use('load-untouched');
    stubWindow();
    const resolve = gateReads({ a: 1 });

    const pending = loadSession(id);
    // A DIFFERENT key, written and persisted during the same window.
    setSessionKey(id, 'other', true);
    await flushSession(id);
    resolve();
    await pending;

    expect<number | undefined>(getSessionValue(id, 'a')).toBe(1);
    expect<boolean | undefined>(getSessionValue(id, 'other')).toBe(true);
  });

  test('a cleared key is not resurrected by a response that still carries it', async () => {
    const id = use('load-cleared');
    stubWindow();
    hydrateSession(id, { retired: 'old', keep: 1 });
    const resolve = gateReads({ retired: 'old', keep: 1 });

    const pending = loadSession(id);
    clearSessionKey(id, 'retired');
    await flushSession(id);
    resolve();
    await pending;

    expect(getSessionValue(id, 'retired')).toBeUndefined();
    expect<number | undefined>(getSessionValue(id, 'keep')).toBe(1);
  });

  test('flushSession is a resolved no-op without a window or id', async () => {
    await expect(flushSession(null)).resolves.toBeUndefined();
    await expect(flushSession(use('flush'))).resolves.toBeUndefined();
  });
});
