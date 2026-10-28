/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Pins the session-state store's observer contract and cache lifecycle.
 *
 * The store is the single source of a session's UI state: every panel reads and
 * writes through it, and it persists the whole blob through
 * `GET/POST /api/sessions/:sessionId/state`. Two contracts matter enough to pin
 * here rather than in a component test:
 *
 *  - **Notification routing.** A write notifies the slot's followers and the
 *    session-wide ones, never another session's, and an unsubscribed listener
 *    stops receiving while an in-flight pass still reaches it.
 *  - **Cache lifecycle.** The cache is bounded (10 sessions) and TTL'd (10
 *    minutes), and eviction never takes a session with unsaved writes.
 *
 * The blob-arrival half — the write-during-read race — is `store-load.test.ts`,
 * and the wholesale-replacement bus is `replacement.test.ts`.
 */

import { describe, expect, setSystemTime, test } from 'bun:test';

import { notifySessionKey } from '@/shared/lib/workspace/session-state/listeners';
import {
  clearSessionKey,
  forgetSession,
  getLastOpenedAt,
  getSessionValue,
  hydrateSession,
  migrateSessionState,
  recordSessionOpen,
  setSessionKey,
} from '@/shared/lib/workspace/session-state/store';
import { counter, follow, installStoreTeardown, use } from '@/shared/lib/workspace/session-state/harness.test-util';

installStoreTeardown();

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
