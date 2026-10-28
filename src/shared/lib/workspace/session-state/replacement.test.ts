/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The store's WHOLESALE-REPLACEMENT notifications.
 *
 * `useSessionState` hands every caller a private copy that deliberately does
 * not follow another component's per-slot write (a panel width is owned by one
 * component). But the store also REPLACES a session's whole state — a blob
 * landing, a hydrate, a spawn-adoption migrate, a delete — and there the copy's
 * value was never written by anyone: it is the fallback the component read on
 * the commit the session id changed. `ready` does not move across an adoption,
 * so without this event every opened right-panel view collapsed at the first
 * send of a new chat (measured: `true:git` → `true:files`).
 *
 * Split from `store.test.ts` for the per-file size ceiling.
 */

import { afterEach, describe, expect, test } from 'bun:test';

import { subscribeSessionReplaced } from '@/shared/lib/workspace/session-state/listeners';
import {
  clearSessionKey,
  forgetSession,
  getSessionValue,
  hydrateSession,
  loadSession,
  migrateSessionState,
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

/** Follow wholesale blob replacements for a session, torn down with the rest. */
function followReplaced(sessionId: string, listener: () => void): () => void {
  const unsubscribe = subscribeSessionReplaced(sessionId, listener);
  unsubs.push(unsubscribe);
  return unsubscribe;
}

/** Count how many times a notification reaches a listener. */
function counter(): { calls: number; listener: () => void } {
  const state = { calls: 0, listener: () => { state.calls += 1; } };
  return state;
}

afterEach(() => {
  for (const unsubscribe of unsubs.splice(0)) unsubscribe();
  for (const id of touched.splice(0)) forgetSession(id);
  Reflect.set(globalThis, 'window', originalWindow);
  Reflect.set(globalThis, 'fetch', originalFetch);
});

describe('session-state store: wholesale replacement notifications', () => {
  test('migrateSessionState announces both ids as replaced', () => {
    const from = use('new-replace');
    const to = use('real-replace');
    setSessionKey(from, 'layout.showRightPanel', true);
    const fromProbe = counter();
    const toProbe = counter();
    followReplaced(from, fromProbe.listener);
    followReplaced(to, toProbe.listener);

    migrateSessionState(from, to);

    expect(fromProbe.calls).toBe(1);
    expect(toProbe.calls).toBe(1);
    expect<boolean | undefined>(getSessionValue(to, 'layout.showRightPanel')).toBe(true);
  });

  test('a per-slot write is NOT a replacement', () => {
    const id = use('slot-write');
    const replaced = counter();
    followReplaced(id, replaced.listener);

    setSessionKey(id, 'layout.activeRightPanel', 'git');
    clearSessionKey(id, 'layout.activeRightPanel');

    // Only the wholesale paths (load/hydrate/migrate/forget) replace state;
    // announcing a write here would make every editor and panel copy re-read
    // on every keystroke elsewhere in the app.
    expect(replaced.calls).toBe(0);
  });

  test('a blob landing, a hydrate and a delete all announce a replacement', async () => {
    const id = use('replace-paths');
    const probe = counter();
    followReplaced(id, probe.listener);
    Reflect.set(globalThis, 'window', {});
    Reflect.set(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ state: { a: 1 } }) }));

    await loadSession(id);
    expect(probe.calls).toBe(1);

    hydrateSession(id, { b: 2 });
    expect(probe.calls).toBe(2);

    forgetSession(id);
    expect(probe.calls).toBe(3);
  });

  test('a subscriber on a null session id is never notified of a replacement', () => {
    const probe = counter();
    followReplaced(null as unknown as string, probe.listener);
    const id = use('replace-null');
    hydrateSession(id, { a: 1 });
    expect(probe.calls).toBe(0);
  });
});
