/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The signal registry must survive a module re-evaluation.
 *
 * This is the bug the `globalThis` slot exists for: `bun --hot` re-evaluates
 * `signals.ts` while `initRealtimeTopics` — guarded by its own
 * `globalThis` flag — never runs again, so the one surviving subscriber is never
 * re-registered. With the registry in module scope the reload left an EMPTY set
 * behind and `emitRealtimeSignal` from the new instance reached nobody: measured
 * on a long-running dev server, `session_stream_state` writes stopped
 * publishing entirely (`sidebar:status`'s sequence never advanced) while topics
 * published by a direct call kept moving — no sidebar spinner, no terminal
 * badge, no activity stamp.
 *
 * A fresh evaluation is simulated the way `bun --hot` produces one: the same
 * source loaded as a SECOND module instance, which shares only `globalThis`.
 * A copy under the temp dir is what makes the two instances two — the module
 * cache is keyed by resolved path, so re-importing the original (bare, file
 * URL, or with a query) hands back the very same namespace, and the identity
 * assertions below would fail on a test that proves nothing.
 */

import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type * as Signals from '@kabmo-labs/kabmo-realtime-signals';
import {
  clearRealtimeSignalListeners,
  emitRealtimeSignal,
  onRealtimeSignal,
} from '@kabmo-labs/kabmo-realtime-signals';

const reloadDir = await mkdtemp(join(tmpdir(), 'kabmo-signals-reload-'));
const reloadPath = join(reloadDir, 'signals.ts');
await Bun.write(reloadPath, await Bun.file(new URL('./signals.ts', import.meta.url)).text());

async function reloadSignals(): Promise<typeof Signals> {
  // The dynamic specifier is the point of this helper, not an accident: a static
  // import cannot produce a second evaluation of the module.
  return (await import(reloadPath)) as typeof Signals;
}

afterAll(async () => {
  await rm(reloadDir, { recursive: true, force: true });
});

beforeEach(() => {
  clearRealtimeSignalListeners();
});

describe('realtime signal registry', () => {
  test('a reloaded instance is a genuinely separate evaluation', async () => {
    const reloaded = await reloadSignals();

    // Both instances share one registry, but they are not the same module.
    expect(reloaded.emitRealtimeSignal).not.toBe(emitRealtimeSignal);
    expect(reloaded.onRealtimeSignal).not.toBe(onRealtimeSignal);
  });

  test('delivers to a listener registered before a module re-evaluation', async () => {
    const seen: string[] = [];
    onRealtimeSignal((event) => seen.push(event.signal));

    const reloaded = await reloadSignals();
    reloaded.emitRealtimeSignal('stream-status');

    expect(seen).toEqual(['stream-status']);
  });

  test('both instances subscribe to and read from one list', async () => {
    const calls: string[] = [];
    onRealtimeSignal((event) => calls.push(`first:${event.signal}`));

    const reloaded = await reloadSignals();
    const unsubscribe = reloaded.onRealtimeSignal((event) => calls.push(`second:${event.signal}`));

    emitRealtimeSignal('sidebar-structure');
    reloaded.emitRealtimeSignal('schedule-changed');
    unsubscribe();
    reloaded.emitRealtimeSignal('panels-changed');

    // One subscription list, and an unsubscribe from either instance removes
    // the listener for both.
    expect(calls).toEqual([
      'first:sidebar-structure',
      'second:sidebar-structure',
      'first:schedule-changed',
      'second:schedule-changed',
      'first:panels-changed',
    ]);
  });

  test('a throwing listener never stops the others', () => {
    const seen: string[] = [];
    onRealtimeSignal(() => {
      throw new Error('boom');
    });
    onRealtimeSignal((event) => seen.push(event.signal));

    emitRealtimeSignal('models-changed');

    expect(seen).toEqual(['models-changed']);
  });
});
