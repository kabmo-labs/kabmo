/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The installed panel plugins, read from the realtime `panels` topic.
 *
 * The registry is a server read, so it is cached in a module-level promise the
 * way the repo list is: every consumer (the activity bar, the panel stack, the
 * mobile tab bar) needs the same list, and re-fetching per consumer would put
 * three requests behind one page load and let them disagree while one is in
 * flight.
 *
 * The topic is what makes the list move: the server republishes `panels` after
 * every install, remove, enable/disable and plugin-file write, so a change made
 * in ANOTHER tab reaches this one too — a window event only ever reached the
 * tab that dispatched it. The one local signal left is the pane's own Refresh,
 * which must bypass the server's scan cache and is therefore a module-level
 * notify rather than a topic frame.
 *
 * The registry says which BUNDLES to load, not what they contain: a plugin's
 * panels exist only once its bundle has run, so `usePanelSlots` below is the
 * other half of this picture.
 */

import { useCallback, useEffect, useState } from 'preact/hooks';
import type {
  PanelCatalogEntry,
  PanelGitStatus,
  PanelMarketplaceItem,
  PanelPluginStatus,
  PanelRegistryEntry,
  PanelRegistryPayload,
  PanelSyncBlocked,
} from '@/shared/types';
import { loadPluginBundles } from '@/client/lib/plugins/loader';
import { useRealtimeTopic } from '@/client/hooks/ui/realtime';
import { TOPIC_PANELS } from '@/shared/lib/realtime/protocol';
import {
  pluginSlotState,
  subscribePluginSlots,
  type PluginSlots,
} from '@/client/lib/plugins/slots';

interface PanelRegistryState {
  /** Installed, enabled plugins — the bundles to import. */
  panels: PanelRegistryEntry[];
  marketplaces: PanelMarketplaceItem[];
  errors: PanelRegistryPayload['errors'];
  /** Build and enablement state per installed plugin. */
  plugins: PanelPluginStatus[];
  /** The bundled marketplace's offers, installed or not. */
  catalog: PanelCatalogEntry[];
  /**
   * Every panel id switched off — a bare built-in view id, or `plugin:<id>`.
   * Read by the built-in registrations and the activity bar; the single source
   * of "is this panel on", shared with the Panel Plugins switches.
   */
  disabledPanels: string[];
  /** The last known freshness of each git-installed plugin, by plugin id. */
  gitStatus: Record<string, PanelGitStatus>;
  /** Whether git-installed plugins are updated automatically. */
  autoUpdate: boolean;
  /** The bundled plugins a local edit stopped from syncing, by plugin id. */
  syncBlocked: Record<string, PanelSyncBlocked>;
  /** False until the first read settles, so a view can hold its placeholder. */
  ready: boolean;
}

const EMPTY: PanelRegistryPayload = {
  panels: [],
  marketplaces: [],
  errors: [],
  plugins: [],
  catalog: [],
  disabledPanels: [],
  gitStatus: {},
  autoUpdate: false,
  syncBlocked: {},
};

/**
 * The shared registry state, module-level so a payload is adopted once (its
 * bundles are imported exactly once, keyed by URL) and a mutation's own
 * response can seed every consumer before the topic republish lands.
 */
interface RegistryStore {
  payload: PanelRegistryPayload;
  ready: boolean;
}

function store(): RegistryStore {
  return (globalThis.__kabmoPanelRegistry ??= { payload: EMPTY, ready: false });
}

declare global {
  // eslint-disable-next-line no-var
  var __kabmoPanelRegistry: RegistryStore | undefined;
}

/** Adopt a payload and load the bundles it names. */
export function adoptPanelRegistry(payload: PanelRegistryPayload): void {
  const host = store();
  host.payload = payload;
  host.ready = true;
  // The bundles are imported right after the list that names them: a panel only
  // exists once its module has run, so the layout has nothing to draw until
  // this settles. A failure is recorded per plugin and surfaced in the pane.
  void loadPluginBundles(
    (payload.panels ?? []).map((panel) => ({ pluginId: panel.pluginId, url: panel.appUrl })),
  );
}

/**
 * Seed the shared state with a payload a mutation already returned.
 *
 * The mutation's response is the server's state at the moment the write
 * committed, which is strictly better than waiting for the topic's own
 * republish — and both carry the same shape, so the two cannot disagree.
 */
export function seedPanelRegistry(payload: PanelRegistryPayload): void {
  adoptPanelRegistry(payload);
}

/**
 * Forget the adopted payload — a test seam, and nothing else.
 *
 * The store is anchored on `globalThis` (a `bun --hot` reload must not lose it),
 * which is also why it survives between test files in one `bun test` process: a
 * suite that adopts a payload with a plugin in it leaves every later suite
 * drawing that plugin's button. A file that adopts one has to put the store
 * back.
 */
export function resetPanelRegistry(): void {
  globalThis.__kabmoPanelRegistry = undefined;
}

/**
 * Re-read the marketplace from disk, bypassing the server's scan cache.
 *
 * A topic refresh cannot express this: the scan is TTL'd, so a plugin copied in
 * moments ago would still be missing. Only the pane's own Refresh sends it.
 */
export async function refreshPanelRegistry(): Promise<void> {
  try {
    const response = await fetch('/api/panels?refresh=1', { credentials: 'same-origin' });
    if (response.ok) adoptPanelRegistry((await response.json()) as PanelRegistryPayload);
  } catch {
    // A failed refresh leaves the last good list on screen; the next topic
    // publish repairs it.
  }
}

export function usePanelRegistry(): PanelRegistryState {
  // The topic is the read path: a snapshot on subscribe, then a push whenever
  // the server writes a plugin. Every consumer subscribes, so each re-renders
  // on its own; adopting into the module store is what loads new bundles once.
  const topic = useRealtimeTopic<PanelRegistryPayload>(TOPIC_PANELS);
  useEffect(() => {
    if (topic.data) adoptPanelRegistry(topic.data);
  }, [topic.data]);

  const host = store();
  const payload = topic.data ?? host.payload;
  return {
    panels: payload.panels ?? [],
    marketplaces: payload.marketplaces ?? [],
    errors: payload.errors ?? [],
    plugins: payload.plugins ?? [],
    catalog: payload.catalog ?? [],
    disabledPanels: payload.disabledPanels ?? [],
    gitStatus: payload.gitStatus ?? {},
    autoUpdate: payload.autoUpdate === true,
    syncBlocked: payload.syncBlocked ?? {},
    ready: host.ready || topic.data !== null,
  };
}

export interface PanelSlotSnapshot {
  /** Registrations by plugin id, for the plugins whose bundles have loaded. */
  slots: Map<string, PluginSlots>;
  /** Plugins whose bundle could not load, with the reason. */
  failures: { pluginId: string; reason: string }[];
}

/**
 * What the loaded bundles registered.
 *
 * Separate from `usePanelRegistry` because the two settle at different times:
 * the registry is a fetch, the slots are an import. A surface that needs a
 * component reads this; a surface that lists plugins reads that.
 */
export function usePanelSlots(): PanelSlotSnapshot {
  const [snapshot, setSnapshot] = useState<PanelSlotSnapshot>(pluginSlotState);
  useEffect(() => {
    setSnapshot(pluginSlotState());
    return subscribePluginSlots(() => setSnapshot(pluginSlotState()));
  }, []);
  return snapshot;
}

/** One plugin's registrations, once its bundle has loaded. */
export function usePluginSlots(pluginId: string | null): PluginSlots | undefined {
  const { slots } = usePanelSlots();
  return pluginId ? slots.get(pluginId) : undefined;
}

/**
 * A mutation that answers with the WHOLE payload.
 *
 * An install changes the catalog, the panel list and the rejections at once, so
 * adopting the response verbatim is what keeps one source of truth — the
 * alternative is a re-read that can race the write and briefly show a state the
 * server never had.
 */
interface PanelMutationResult {
  ok: boolean;
  error?: string;
  /**
   * A success that still has something to say — a remove whose directory went
   * but whose catalog entry could not be pruned. The action succeeded and the
   * payload is current; the pane would otherwise report the leftover entry as a
   * rejection with no hint of where it came from.
   */
  warning?: string;
  payload?: PanelRegistryPayload;
}

export interface PanelPluginActions {
  /** The action in flight, so a row can show which one is running. */
  busy: string | null;
  error: string | null;
  clearError: () => void;
  /** Install from a git URL. */
  install: (url: string) => Promise<boolean>;
  /** Install one plugin the bundled marketplace offers, by id. */
  installBundled: (pluginId: string) => Promise<boolean>;
  remove: (pluginId: string) => Promise<boolean>;
  /** Drop a catalog entry whose directory is already gone, by its source path. */
  forget: (source: string) => Promise<boolean>;
  build: (pluginId: string) => Promise<boolean>;
  /** Switch a plugin's contributions on or off; its files stay on disk. */
  setEnabled: (pluginId: string, enabled: boolean) => Promise<boolean>;
  /** Probe every git-installed plugin's remote for a newer commit. */
  checkUpdates: () => Promise<boolean>;
  /** Bring one git-installed plugin up to its remote, and rebuild it. */
  updateGit: (pluginId: string) => Promise<boolean>;
  /** Turn automatic updating of git-installed plugins on or off. */
  setAutoUpdate: (enabled: boolean) => Promise<boolean>;
  /** Replace a blocked bundled plugin's edited files with the store's copy. */
  forceSync: (pluginId: string) => Promise<boolean>;
}

/**
 * A plugin is a Bun package, so its UI is served from a build output. That
 * makes "the manifest is valid but the build has not run" a state a user can be
 * in — a fresh clone, an interrupted install, a source edit — and `build` is the
 * one action that resolves it without re-installing.
 */
async function mutatePanelPlugin(body: Record<string, unknown>): Promise<PanelMutationResult> {
  const endpoint = body.type === 'build' ? '/api/panels/build' : '/api/panels/install';
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const parsed = (await response.json().catch(() => null)) as
      | (PanelRegistryPayload & { error?: string })
      | null;
    if (!parsed) return { ok: false, error: `Request failed (${response.status})` };
    const { error, ...payload } = parsed;
    if (!response.ok) return { ok: false, error: error ?? `Request failed (${response.status})` };
    return { ok: true, ...(error ? { warning: error } : {}), payload };
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : String(cause) };
  }
}

export function usePanelPluginActions(): PanelPluginActions {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (label: string, body: Record<string, unknown>): Promise<boolean> => {
    setBusy(label);
    setError(null);
    const result = await mutatePanelPlugin(body);
    setBusy(null);
    if (!result.ok) {
      setError(result.error ?? 'The request failed.');
      return false;
    }
    // A success with a warning is still a success — the payload is adopted and
    // the pane re-reads — but the reason surfaces, because the leftover catalog
    // entry it names shows up as a rejection row right below.
    if (result.warning) setError(result.warning);
    // Every consumer re-reads from the response, not from a second fetch — the
    // server's own republish of the `panels` topic follows, and both carry the
    // same payload.
    if (result.payload) seedPanelRegistry(result.payload);
    return true;
  }, []);

  const install = useCallback((url: string) => run('install', { type: 'install', url }), [run]);
  const installBundled = useCallback(
    (pluginId: string) => run(`install:${pluginId}`, { type: 'install', pluginId }),
    [run],
  );
  const remove = useCallback((pluginId: string) => run(`remove:${pluginId}`, { type: 'remove', pluginId }), [run]);
  const forget = useCallback((source: string) => run(`forget:${source}`, { type: 'forget', source }), [run]);
  const build = useCallback((pluginId: string) => run(`build:${pluginId}`, { type: 'build', pluginId }), [run]);
  const setEnabled = useCallback(
    (pluginId: string, enabled: boolean) =>
      run(`${enabled ? 'enable' : 'disable'}:${pluginId}`, { type: enabled ? 'enable' : 'disable', pluginId }),
    [run],
  );
  const checkUpdates = useCallback(() => run('check_updates', { type: 'check_updates' }), [run]);
  const updateGit = useCallback((pluginId: string) => run(`update_git:${pluginId}`, { type: 'update_git', pluginId }), [run]);
  const setAutoUpdate = useCallback(
    (enabled: boolean) => run('set_auto_update', { type: 'set_auto_update', enabled }),
    [run],
  );
  const forceSync = useCallback((pluginId: string) => run(`force_sync:${pluginId}`, { type: 'force_sync', pluginId }), [run]);

  return {
    busy,
    error,
    clearError: () => setError(null),
    install,
    installBundled,
    remove,
    forget,
    build,
    setEnabled,
    checkUpdates,
    updateGit,
    setAutoUpdate,
    forceSync,
  };
}
