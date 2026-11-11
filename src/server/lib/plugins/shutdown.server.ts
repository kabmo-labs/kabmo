/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Unloading every plugin on the way out, BOUNDED so a plugin cannot block the
 * exit.
 *
 * Split from `loader.server.ts` for the per-file ceiling; the rule it enforces
 * is the loader's own: a plugin's disposer owns real work — a spawned child, a
 * listener, a timer — and `onDispose` is the only place it is released. Without
 * this the process exits with those alive: a detached child outlives its parent
 * by definition, so a command a plugin started would keep running after Kabmo
 * is gone (verified: the plugin's own `Bun.spawn({ detached: true })` children
 * survive a `SIGTERM` to the server).
 *
 * The timeout is the other half of the contract. `disposePlugin` awaits each
 * disposer in turn, and one that never settles would hang the shutdown forever
 * — worse than the leak, because the operator cannot get their port back. The
 * pass therefore resolves on its own and reports what it had to abandon; the
 * process exits either way.
 *
 * Never throws: a failure here must not turn a clean shutdown into a crash.
 */

import { disposeAllPlugins, loadedPluginIds } from '@/server/lib/plugins/loader.server';

/** How long shutdown waits for a plugin's disposers before giving up. */
const SHUTDOWN_DISPOSE_TIMEOUT_MS = 3_000;

export async function disposeAllPluginsOnShutdown(
  /** The bound, overridable so a test does not wait out the real one. */
  timeoutMs: number = SHUTDOWN_DISPOSE_TIMEOUT_MS,
): Promise<{ disposed: number; timedOut: boolean }> {
  const ids = loadedPluginIds();
  if (ids.length === 0) return { disposed: 0, timedOut: false };

  const gate = Promise.withResolvers<boolean>();
  const timer = setTimeout(() => gate.resolve(false), timeoutMs);
  const pass = disposeAllPlugins().then(
    () => true,
    (error: unknown) => {
      console.error(`[plugins] shutdown: disposal failed — ${error instanceof Error ? error.message : String(error)}`);
      return true;
    },
  );
  // Either the pass settles or the timer fires; the loser is abandoned rather
  // than awaited, which is the whole point of the bound.
  const completed = await Promise.race([pass, gate.promise]);
  clearTimeout(timer);
  if (!completed) {
    console.error(
      `[plugins] shutdown: disposal did not finish within ${timeoutMs}ms — exiting anyway`,
    );
  }
  return { disposed: ids.length, timedOut: !completed };
}
