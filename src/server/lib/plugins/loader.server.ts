/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Loading a plugin's SERVER half, and unloading it again.
 *
 * A plugin's `server.ts` is a module Kabmo's own process imports — the
 * same trust decision the browser bundle already carries, stated once here so
 * it is not re-litigated per call site. What the host controls is the SHAPE:
 * the factory is handed an API bound to its own id, and everything it registers
 * is recorded so a reload can undo it.
 *
 * Three properties are load-bearing, and each was a decision rather than an
 * accident:
 *
 * - **The entry is BUILT, not imported from source.** A plugin's `server.ts` is
 *   TypeScript importing `@kabmo-labs/kabmo-sdk`; Kabmo's process runs
 *   the bundle the plugin's build produced, exactly as the browser runs the
 *   `app` bundle. One build path, one artifact, no `tsx` in the server.
 * - **Disposal is exact-once and LIFO.** A reload that runs a disposer twice (or
 *   zero times) leaks a timer, a subscription or a scheduled run. Every
 *   registration goes through `track()`, which is the only writer of the list.
 * - **A plugin that throws is REPORTED, not skipped.** Silence reads as "this
 *   plugin does nothing", which is the one thing a user cannot debug.
 */

import { join } from 'path';
import { pathExists } from '@/server/lib/omp/core/paths';
import { getDb } from '@/server/db.server';
import { findPluginDir, discoverPanelPlugins } from '@/server/lib/panels/registry.server';
import { readPluginManifest } from '@/server/lib/panels/files.server';
import { toManifest } from '@/server/lib/panels/manifest';
import { createPluginStorage } from '@/server/lib/plugins/storage.server';
import { createPluginSettings, clearPluginSettingListeners } from '@/server/lib/plugins/settings.server';
import { registerRpcMethod, clearPluginRpcMethods } from '@/server/lib/plugins/rpc.server';
import { createPluginHttp, clearPluginHttpRoutes } from '@/server/lib/plugins/http.server';
import { createPluginRealtime, clearPluginTopic } from '@/server/lib/plugins/realtime.server';
import { createPluginEvents, clearPluginEvents } from '@/server/lib/plugins/events.server';
import { createPluginBackground, type PluginBackgroundHandle } from '@/server/lib/plugins/background.server';
import { createPluginLogger } from '@/server/lib/plugins/log.server';
import type { KabmoPluginApi, KabmoPluginFactory } from '@kabmo-labs/kabmo-sdk';

/** One loaded plugin, as the runtime holds it. */
export interface LoadedPlugin {
  pluginId: string;
  /** The API the factory received — kept for a host that needs to read settings. */
  api: KabmoPluginApi;
  background: PluginBackgroundHandle;
  /** The disposers, in registration order. Run in reverse. */
  disposers: Array<() => void | Promise<void>>;
}

/** A plugin that could not load, with the reason a pane can render. */
export interface PluginLoadError {
  pluginId: string;
  reason: string;
}

/**
 * The loaded plugins, process-wide.
 *
 * Anchored on `globalThis` for the reason every other registry here is: under
 * `bun --hot` this module re-evaluates while the plugins it loaded are still
 * running, and a module-level map would come back empty — their disposers would
 * be unreachable and the next load would run a second copy beside the first.
 */
declare global {
  // eslint-disable-next-line no-var
  var __kabmoLoadedPlugins: Map<string, LoadedPlugin> | undefined;
  // eslint-disable-next-line no-var
  var __kabmoPluginLoadErrors: PluginLoadError[] | undefined;
  // eslint-disable-next-line no-var
  var __kabmoPluginPlatformReady: boolean | undefined;
}

function loaded(): Map<string, LoadedPlugin> {
  return (globalThis.__kabmoLoadedPlugins ??= new Map());
}

/**
 * Whether the boot's plugin pass has FINISHED.
 *
 * The listener answers `/api/health` before this pass runs — the boot awaits
 * `syncBundledPlugins`, then every server half, after `Bun.serve` is up — so a
 * client that reloads on "a different process answers health" lands in a server
 * whose plugins are still loading. Every plugin RPC then answers 404, which the
 * kit reports as `plugin_not_loaded` and a caller can only read as "this plugin
 * is not running" (measured after a restart: the Stats readout's `watch` fired
 * 194 ms into the new page, 404'd, and never retried — the header read the
 * `—` placeholder until a manual reload, ~500 ms after the halves were up).
 *
 * Health carries this so the CLIENT can tell "not loaded YET" from "not loaded",
 * and retry only the first. Set in a `finally`: a plugin that fails to load must
 * not leave the flag false forever, or every later RPC would be retried for the
 * whole ceiling.
 */
export function markPluginPlatformReady(): void {
  globalThis.__kabmoPluginPlatformReady = true;
}

/** Whether the boot's plugin pass has finished. False until then. */
export function pluginPlatformReady(): boolean {
  return globalThis.__kabmoPluginPlatformReady === true;
}

/** Why a plugin did not load, for the pane. Empty when everything loaded. */
export function pluginLoadErrors(): PluginLoadError[] {
  return globalThis.__kabmoPluginLoadErrors ?? [];
}

/**
 * Record — or clear — a plugin's load failure, for the pane's error list.
 *
 * `loadPluginServers` writes this list once at boot, but a plugin is also loaded
 * and unloaded at RUNTIME (the install route syncs a plugin's server half the
 * moment it is installed or switched on). Without this, a runtime failure had no
 * reader: the load threw, the route logged it, and `GET /api/plugins/state`
 * still answered the boot-time list — so the pane showed nothing.
 *
 * A `null` reason CLEARS the entry, which is what makes a later success stop
 * being reported as a failure (a plugin fixed by a rebuild, or re-enabled after
 * a transient fault). The list is keyed by plugin id, so this is an upsert.
 */
export function notePluginLoadFailure(pluginId: string, reason: string | null): void {
  const current = globalThis.__kabmoPluginLoadErrors ?? [];
  const without = current.filter((entry) => entry.pluginId !== pluginId);
  globalThis.__kabmoPluginLoadErrors = reason === null ? without : [...without, { pluginId, reason }];
}

/** The API as it stands, or undefined when the plugin is not loaded. */
export function loadedPlugin(pluginId: string): LoadedPlugin | undefined {
  return loaded().get(pluginId);
}

/** Every loaded plugin id, in load order. */
export function loadedPluginIds(): string[] {
  return [...loaded().keys()];
}

/**
 * Load one plugin's server half.
 *
 * `dir` is resolved from the registry rather than taken from the caller, so the
 * only plugins reachable here are ones the scan already admitted — installed,
 * enabled, and compatible.
 */
export async function loadPluginServer(pluginId: string): Promise<LoadedPlugin> {
  const existing = loaded().get(pluginId);
  if (existing) return existing;

  const dir = await findPluginDir(pluginId);
  if (!dir) throw new Error(`no installed plugin with the id "${pluginId}"`);

  const read = await readPluginManifest(dir);
  if (read.kind !== 'manifest') throw new Error(`plugin "${pluginId}" has no readable manifest`);
  const parsed = toManifest(read.value, dir);
  if ('error' in parsed) throw new Error(parsed.error);
  if (!parsed.server) throw new Error(`plugin "${pluginId}" declares no server entry`);

  const entry = join(dir, parsed.server);
  if (!(await pathExists(entry))) throw new Error(`plugin "${pluginId}" is not built: ${parsed.server} is missing`);

  const module = (await import(entry)) as { default?: unknown };
  if (typeof module.default !== 'function') {
    throw new Error(`plugin "${pluginId}" has no server factory default export (export default function plugin(api) {})`);
  }

  const db = await getDb();
  const disposers: Array<() => void | Promise<void>> = [];
  const track = (dispose: () => void | Promise<void>) => {
    disposers.push(dispose);
  };

  const storage = createPluginStorage(db, pluginId);
  const background = createPluginBackground(pluginId);
  const events = createPluginEvents(pluginId);

  const api: KabmoPluginApi = {
    pluginId,
    log: createPluginLogger(pluginId),
    storage,
    settings: createPluginSettings(db, pluginId, parsed.settings ?? {}),
    rpc: {
      register(method, definition) {
        const dispose = registerRpcMethod(pluginId, method, definition);
        track(dispose);
        return dispose;
      },
    },
    http: createPluginHttp(pluginId),
    realtime: createPluginRealtime(pluginId),
    events: events,
    background: background.api,
    onDispose(hook) {
      if (typeof hook !== 'function') throw new Error('onDispose expects a function');
      track(hook);
    },
  };

  const record: LoadedPlugin = { pluginId, api, background: background.handle, disposers };
  // Registered BEFORE the factory runs: a factory that registers something and
  // then throws still needs its partial registrations disposed, and the only
  // way to reach them is for the record to exist.
  loaded().set(pluginId, record);

  try {
    await (module.default as KabmoPluginFactory)(api);
  } catch (error) {
    await disposePlugin(pluginId);
    throw new Error(`plugin "${pluginId}" failed to load: ${error instanceof Error ? error.message : String(error)}`);
  }

  return record;
}

/**
 * Unload one plugin: run its disposers in reverse, then drop every registry it
 * wrote to.
 *
 * The registry clears are not belt-and-braces — a plugin that registered an RPC
 * method without an `onDispose` would otherwise keep answering after it was
 * switched off, because the method map outlives the plugin's own record.
 */
export async function disposePlugin(pluginId: string): Promise<void> {
  const record = loaded().get(pluginId);
  loaded().delete(pluginId);
  clearPluginRpcMethods(pluginId);
  clearPluginHttpRoutes(pluginId);
  clearPluginEvents(pluginId);
  clearPluginSettingListeners(pluginId);
  clearPluginTopic(pluginId);
  if (!record) return;

  for (const dispose of [...record.disposers].reverse()) {
    try {
      await dispose();
    } catch (error) {
      // A throwing disposer must not stop the others: the remaining ones own
      // timers and subscriptions, and leaking them is worse than a log line.
      console.error(`[plugins] ${pluginId}: disposer threw — ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/**
 * Load every plugin that declares a server entry.
 *
 * Sequential rather than concurrent: a factory may write to shared tables, and
 * a deterministic order makes a failure reproducible. The list is short (a
 * handful of plugins), so the cost is one module import each.
 *
 * Never throws. A plugin that cannot load is recorded and the pass continues —
 * one broken plugin must not stop the others from starting.
 */
export async function loadPluginServers(): Promise<{ loaded: string[]; errors: PluginLoadError[] }> {
  const errors: PluginLoadError[] = [];
  const ids: string[] = [];
  try {
    const payload = await discoverPanelPlugins();

    for (const plugin of payload.plugins) {
      if (!plugin.enabled || !plugin.built) continue;
      try {
        const record = await loadPluginServer(plugin.pluginId);
        if (record) ids.push(plugin.pluginId);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        // A plugin with no server entry is not an error — most plugins are
        // UI-only, and reporting those would make a normal install look broken.
        if (reason.includes('declares no server entry')) continue;
        errors.push({ pluginId: plugin.pluginId, reason });
      }
    }

    globalThis.__kabmoPluginLoadErrors = errors;
    return { loaded: ids, errors };
  } finally {
    // After the LAST half, whichever way the pass ended: a plugin that threw is
    // a plugin that will not answer, and leaving the flag false would make every
    // plugin RPC on the new page retry against a server that is done loading.
    markPluginPlatformReady();
  }
}

/** Unload every plugin — used by a forced reload and by tests. */
export async function disposeAllPlugins(): Promise<void> {
  for (const pluginId of [...loaded().keys()]) {
    await disposePlugin(pluginId);
  }
}

/** How long shutdown waits for a plugin's disposers before giving up. */
const SHUTDOWN_DISPOSE_TIMEOUT_MS = 3_000;

/**
 * Unload every plugin on the way out, BOUNDED so a plugin cannot block the exit.
 *
 * A plugin's disposer owns real work — a spawned child, a listener, a timer —
 * and `onDispose` is the only place it is released. Without this the process
 * exits with those alive: a detached child outlives its parent by definition,
 * so a command a plugin started would keep running after Kabmo is gone
 * (verified: the plugin's own `Bun.spawn({ detached: true })` children survive a
 * `SIGTERM` to the server).
 *
 * The timeout is the other half of the contract. `disposePlugin` awaits each
 * disposer in turn, and one that never settles would hang the shutdown forever
 * — worse than the leak, because the operator cannot get their port back. The
 * pass therefore resolves on its own and reports what it had to abandon; the
 * process exits either way.
 *
 * Never throws: a failure here must not turn a clean shutdown into a crash.
 */
export async function disposeAllPluginsOnShutdown(
  /** The bound, overridable so a test does not wait out the real one. */
  timeoutMs: number = SHUTDOWN_DISPOSE_TIMEOUT_MS,
): Promise<{ disposed: number; timedOut: boolean }> {
  const ids = [...loaded().keys()];
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
