/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Plugin disposal on the way out, and the bound that keeps it from hanging.
 *
 * Two properties, and the second is the one that is easy to get wrong:
 *
 * - **Every loaded plugin is disposed.** A plugin's `onDispose` owns real work
 *   (a spawned child, a listener, a timer) and nothing else releases it. The
 *   failure this catches is a server that exits with a plugin's detached child
 *   still running — invisible from the server's own log, and the reason the
 *   hook exists at all.
 * - **A disposer that never settles does not block the exit.** `disposePlugin`
 *   awaits each disposer in turn, so one that returns a forever-pending promise
 *   would hang shutdown indefinitely. The pass resolves on its own and reports
 *   `timedOut`, which is what makes it safe to await from a signal handler.
 *
 * The records are seeded directly rather than through `loadPluginServer`: that
 * path needs a built plugin on disk, and neither property here is about the
 * build. What matters is the shape `disposePlugin` walks — a record with
 * disposers — which is what a real load produces.
 *
 * The database is the isolated one: `disposePlugin` clears plugin RPC methods
 * and settings listeners, and `getDb()` is a process-wide handle a suite must
 * not open against the developer's real file.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { disposeAllPluginsOnShutdown, loadedPluginIds } from '@/server/lib/plugins/loader.server';
import type { KabmoPluginApi } from '@kabmo-labs/kabmo-sdk';

/** The registry `disposePlugin` reads, process-wide and anchored on globalThis. */
function seed(pluginId: string, disposers: Array<() => void | Promise<void>>): void {
  const record = {
    pluginId,
    // A record is only ever read for its disposers by the disposal path, and a
    // real api would need a database. The cast keeps the fixture honest about
    // what is exercised.
    api: { pluginId } as unknown as KabmoPluginApi,
    background: { services: [], schedules: [] },
    disposers,
  };
  const host = globalThis as unknown as { __kabmoLoadedPlugins?: Map<string, typeof record> };
  const map = (host.__kabmoLoadedPlugins ??= new Map());
  map.set(pluginId, record);
}

afterEach(() => {
  globalThis.__kabmoLoadedPlugins = undefined;
});

describe('disposeAllPluginsOnShutdown', () => {
  test('is a no-op with nothing loaded', async () => {
    const result = await disposeAllPluginsOnShutdown(50);
    expect(result).toEqual({ disposed: 0, timedOut: false });
  });

  test('runs every loaded plugin\u2019s disposers', async () => {
    const ran: string[] = [];
    seed('alpha', [() => { ran.push('alpha'); }]);
    seed('beta', [() => { ran.push('beta-1'); }, () => { ran.push('beta-2'); }]);

    const result = await disposeAllPluginsOnShutdown(500);

    expect(result).toEqual({ disposed: 2, timedOut: false });
    expect(ran).toContain('alpha');
    expect(ran).toContain('beta-1');
    expect(ran).toContain('beta-2');
    // Disposal is what unloads them; a record left behind would be re-disposed
    // on the next pass and its registrations would answer after shutdown.
    expect(loadedPluginIds()).toEqual([]);
  });

  test('a disposer that never settles does not block the exit', async () => {
    const never = Promise.withResolvers<void>();
    seed('stuck', [() => never.promise]);

    const started = Date.now();
    const result = await disposeAllPluginsOnShutdown(60);

    expect(result.timedOut).toBe(true);
    // The bound is what is under test: it must resolve on its own rather than
    // waiting for the pending promise.
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  test('a throwing disposer does not stop the others, and they run in REVERSE order', async () => {
    const ran: string[] = [];
    seed('mixed', [
      () => { ran.push('first'); },
      () => { throw new Error('boom'); },
      () => { ran.push('third'); },
    ]);

    const result = await disposeAllPluginsOnShutdown(500);

    expect(result.timedOut).toBe(false);
    // Reverse: a disposer registered later may depend on one registered before
    // it, so teardown mirrors setup (`disposePlugin` reverses the list).
    expect(ran).toEqual(['third', 'first']);
  });
});
