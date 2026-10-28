/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Shared harness for the session-state store's suites.
 *
 * Split out when `store.test.ts` passed the per-file ceiling. Every case in
 * every suite needs the same three things — an id that teardown forgets, a
 * subscription that teardown cancels, and a counter — and a per-file copy is how
 * two suites end up disagreeing about what teardown restores.
 */

import { afterEach, setSystemTime } from 'bun:test';

import { subscribeSessionKey } from '@/shared/lib/workspace/session-state/listeners';
import { forgetSession } from '@/shared/lib/workspace/session-state/store';

/** The runner's own fetch, reached through `Bun` so a stub leaked onto the global cannot be mistaken for it. */
export const originalFetch = Bun.fetch;
export const originalWindow = Reflect.get(globalThis, 'window');

const touched: string[] = [];
const unsubs: Array<() => void> = [];

/** Register a session id so teardown forgets it. */
export function use(id: string): string {
  touched.push(id);
  return id;
}

/** Subscribe and auto-unsubscribe at teardown. */
export function follow(sessionId: string | null, key: string | null, listener: () => void): () => void {
  const unsubscribe = subscribeSessionKey(sessionId, key, listener);
  unsubs.push(unsubscribe);
  return unsubscribe;
}

/** Count how many times a notification reaches a listener. */
export function counter(): { calls: number; listener: () => void } {
  const state = { calls: 0, listener: () => { state.calls += 1; } };
  return state;
}

/** Install the suite's teardown. Called once per test file. */
export function installStoreTeardown(): void {
  afterEach(() => {
    for (const unsubscribe of unsubs.splice(0)) unsubscribe();
    for (const id of touched.splice(0)) forgetSession(id);
    Reflect.set(globalThis, 'window', originalWindow);
    Reflect.set(globalThis, 'fetch', originalFetch);
    setSystemTime();
  });
}
