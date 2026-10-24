/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pins the session-state store's observer contract and cache lifecycle.
 *
 * The store is a module singleton with private Maps, so the tests drive it
 * only through its exports and tear every touched session down with
 * `forgetSession` (which clears the cache entry, its dirty flag and its
 * pending persist timer). What matters here: a write notifies exactly the
 * followers of that (session, slot), a blob arriving notifies every follower
 * of the session, a delete notifies, and the merge rules keep a local write
 * from being clobbered by a stored blob that predates it.
 */

import { afterEach, describe, expect, setSystemTime, test } from 'bun:test';

import { notifySessionKey, subscribeSessionKey } from '@/shared/lib/workspace/session-state/listeners';
import {
  clearSessionKey,
  flushSession,
  forgetSession,
  getLastOpenedAt,
  getSessionValue,
  hydrateSession,
  loadSession,
  migrateSessionState,
  recordSessionOpen,
  setSessionKey,
} from '@/shared/lib/workspace/session-state/store';

const originalWindow = Reflect.get(globalThis, 'window');
/** The runner's own fetch, reached through `Bun` so a stub leaked onto the global cannot be mistaken for it. */
const originalFetch = Bun.fetch;
const touched: string[] = [];
const unsubs: Array<() => void> = [];

/** Register a session id so `afterEach` forgets it. */
function use(id: string): string {
  touched.push(id);
  return id;
}

/** Subscribe and auto-unsubscribe at teardown. */
function follow(sessionId: string | null, key: string | null, listener: () => void): () => void {
  const unsubscribe = subscribeSessionKey(sessionId, key, listener);
  unsubs.push(unsubscribe);
  return unsubscribe;
}

/** Count how many times `notifySessionKey` reaches a listener. */
function counter(): { calls: number; listener: () => void } {
  const state = { calls: 0, listener: () => { state.calls += 1; } };
  return state;
}

afterEach(() => {
  for (const unsubscribe of unsubs.splice(0)) unsubscribe();
  for (const id of touched.splice(0)) forgetSession(id);
  Reflect.set(globalThis, 'window', originalWindow);
  Reflect.set(globalThis, 'fetch', originalFetch);
  setSystemTime();
});

describe('session-state store: read/write', () => {
  test('a null session id is a no-op for reads and writes', () => {
    const probe = counter();
    follow(use('null-write'), 'k', probe.listener);
    setSessionKey(null, 'k', 1);
    clearSessionKey(null, 'k');
    hydrateSession(null, { k: 2 });
    expect(getSessionValue(null, 'k')).toBeUndefined();
    expect(probe.calls).toBe(0);
  });

  test('setSessionKey writes and overwrites a slot, untyped by design', () => {
    const id = use('rw');
    expect(getSessionValue(id, 'a')).toBeUndefined();
    setSessionKey(id, 'a', 1);
    expect(getSessionValue<number>(id, 'a')).toBe(1);
    setSessionKey(id, 'a', { nested: true });
    expect<Record<string, boolean> | undefined>(getSessionValue(id, 'a')).toEqual({ nested: true });
  });

  test('recordSessionOpen stamps lastTouched only for a real id', () => {
    const id = use('opened');
    expect(getLastOpenedAt(id)).toBeUndefined();
    recordSessionOpen(id);
    expect(typeof getLastOpenedAt(id)).toBe('number');
    recordSessionOpen(null);
    expect(getLastOpenedAt('never-opened')).toBeUndefined();
  });
});

describe('session-state store: notification routing', () => {
  test('setSessionKey notifies the slot and the session-wide follower, not others', () => {
    const id = use('notify');
    const other = use('notify-other');
    const onA = counter();
    const onB = counter();
    const onAny = counter();
    const onOtherSession = counter();
    follow(id, 'a', onA.listener);
    follow(id, 'b', onB.listener);
    follow(id, null, onAny.listener);
    follow(other, 'a', onOtherSession.listener);

    setSessionKey(id, 'a', 1);
    expect(onA.calls).toBe(1);
    expect(onAny.calls).toBe(1);
    expect(onB.calls).toBe(0);
    expect(onOtherSession.calls).toBe(0);

    setSessionKey(id, 'b', 2);
    expect(onB.calls).toBe(1);
    expect(onAny.calls).toBe(2);
    expect(onA.calls).toBe(1);
  });

  test('clearSessionKey notifies only when the key was present', () => {
    const id = use('clear');
    const probe = counter();
    follow(id, 'gone', probe.listener);
    setSessionKey(id, 'kept', 1);
    clearSessionKey(id, 'never-set');
    expect(probe.calls).toBe(0);
    setSessionKey(id, 'gone', 2);
    expect(probe.calls).toBe(1);
    clearSessionKey(id, 'gone');
    expect(probe.calls).toBe(2);
    expect(getSessionValue(id, 'gone')).toBeUndefined();
    expect<string | number | boolean | Record<string, unknown> | unknown[] | null | undefined>(getSessionValue(id, 'kept')).toBe(1);
  });

  test('hydrateSession merges over existing slots and notifies every follower', () => {
    const id = use('hydrate');
    const onKey = counter();
    const onAny = counter();
    follow(id, 'a', onKey.listener);
    follow(id, null, onAny.listener);
    setSessionKey(id, 'a', 1);
    hydrateSession(id, { b: 2 });
    expect<number | undefined>(getSessionValue(id, 'a')).toBe(1);
    expect<string | number | boolean | Record<string, unknown> | unknown[] | null | undefined>(getSessionValue(id, 'b')).toBe(2);
    expect(onKey.calls).toBe(2);
    expect(onAny.calls).toBe(2);
  });

  test('forgetSession drops the state and notifies the session', () => {
    const id = use('forget');
    const onKey = counter();
    const onAny = counter();
    follow(id, 'a', onKey.listener);
    follow(id, null, onAny.listener);
    setSessionKey(id, 'a', 1);
    forgetSession(id);
    expect(getLastOpenedAt(id)).toBeUndefined();
    expect(getSessionValue(id, 'a')).toBeUndefined();
    expect(onKey.calls).toBe(2);
    expect(onAny.calls).toBe(2);
  });

  test('migrateSessionState moves state, keeps existing target keys, notifies both ids', () => {
    const from = use('new-1');
    const to = use('real-1');
    const fromProbe = counter();
    const toProbe = counter();
    follow(from, null, fromProbe.listener);
    follow(to, null, toProbe.listener);
    setSessionKey(from, 'draft', 'hello');
    setSessionKey(from, 'clash', 'from');
    setSessionKey(to, 'clash', 'to');

    migrateSessionState(from, to);
    expect(getLastOpenedAt(from)).toBeUndefined();
    expect<string | number | boolean | Record<string, unknown> | unknown[] | null | undefined>(getSessionValue(to, 'draft')).toBe('hello');
    expect<string | number | boolean | Record<string, unknown> | unknown[] | null | undefined>(getSessionValue(to, 'clash')).toBe('to');
    expect(getSessionValue(from, 'draft')).toBeUndefined();
    expect(toProbe.calls).toBe(2);
    expect(fromProbe.calls).toBe(3);
  });

  test('an unsubscribe stops later notifications but not the in-flight pass', () => {
    const id = use('unsub');
    const first = counter();
    const second = counter();
    const stop = follow(id, 'k', first.listener);
    follow(id, 'k', second.listener);

    // `notifySessionKey` iterates a snapshot, so a listener removed during the
    // pass still runs once; afterwards it is gone.
    follow(id, 'k', () => stop());
    setSessionKey(id, 'k', 1);
    expect(first.calls).toBe(1);
    expect(second.calls).toBe(1);

    setSessionKey(id, 'k', 2);
    expect(first.calls).toBe(1);
    expect(second.calls).toBe(2);
  });

  test('a subscriber on a null session id is never notified', () => {
    const probe = counter();
    follow(null, null, probe.listener);
    const id = use('null-listener');
    setSessionKey(id, 'k', 1);
    notifySessionKey(id, 'k');
    expect(probe.calls).toBe(0);
  });
});

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

describe('session-state store: bounded cache', () => {
  test('the oldest clean session is evicted past the size cap', () => {
    const ids = Array.from({ length: 11 }, (_unused, index) => use(`lru-${index}`));
    for (const [index, id] of ids.entries()) hydrateSession(id, { n: index });

    expect(getSessionValue(ids[0], 'n')).toBeUndefined();
    expect<string | number | boolean | Record<string, unknown> | unknown[] | null | undefined>(getSessionValue(ids[10], 'n')).toBe(10);
  });

  test('a session idle past the TTL is evicted on the next write', () => {
    const stale = use('ttl-stale');
    const fresh = use('ttl-fresh');
    hydrateSession(stale, { n: 1 });
    setSystemTime(Date.now() + 11 * 60 * 1000);
    hydrateSession(fresh, { n: 2 });
    expect(getSessionValue(stale, 'n')).toBeUndefined();
    expect<string | number | boolean | Record<string, unknown> | unknown[] | null | undefined>(getSessionValue(fresh, 'n')).toBe(2);
  });
});
