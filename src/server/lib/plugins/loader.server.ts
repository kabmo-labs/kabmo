/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Loading a plugin's SERVER half, and unloading it again.
 *
 * A plugin's `server.ts` is a module the chamber's own process imports — the
 * same trust decision the browser bundle already carries, stated once here so
 * it is not re-litigated per call site. What the host controls is the SHAPE:
 * the factory is handed an API bound to its own id, and everything it registers
 * is recorded so a reload can undo it.
 *
 * Three properties are load-bearing, and each was a decision rather than an
 * accident:
 *
 * - **The entry is BUILT, not imported from source.** A plugin's `server.ts` is
 *   TypeScript importing `@ompchamber/plugin-sdk`; the chamber's process runs
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
import type { ChamberPluginApi, ChamberPluginFactory } from '@ompchamber/plugin-sdk';

/** One loaded plugin, as the runtime holds it. */
export interface LoadedPlugin {
  pluginId: string;
  /** The API the factory received — kept for a host that needs to read settings. */
  api: ChamberPluginApi;
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
  var __ompChamberLoadedPlugins: Map<string, LoadedPlugin> | undefined;
  // eslint-disable-next-line no-var
  var __ompChamberPluginLoadErrors: PluginLoadError[] | undefined;
}

function loaded(): Map<string, LoadedPlugin> {
  return (globalThis.__ompChamberLoadedPlugins ??= new Map());
}

/** Why a plugin did not load, for the pane. Empty when everything loaded. */
export function pluginLoadErrors(): PluginLoadError[] {
  return globalThis.__ompChamberPluginLoadErrors ?? [];
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

  const api: ChamberPluginApi = {
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
    await (module.default as ChamberPluginFactory)(api);
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

  globalThis.__ompChamberPluginLoadErrors = errors;
  return { loaded: ids, errors };
}

/** Unload every plugin — used by a forced reload and by tests. */
export async function disposeAllPlugins(): Promise<void> {
  for (const pluginId of [...loaded().keys()]) {
    await disposePlugin(pluginId);
  }
}
