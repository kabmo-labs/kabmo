/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The pane's mutations, one thin wrapper per `/api/panels/*` verb.
 *
 * Split from `panel-registry.ts` when the registry list pushed that module to
 * its file-size ceiling: the read path (adopting a payload, loading bundles,
 * subscribing to the topic) and the write path are different questions, and only
 * the read path is imported by the layout.
 */

import { useCallback, useState } from 'preact/hooks';
import type { PanelRegistryPayload } from '@/shared/types';
import { seedPanelRegistry } from '@/client/hooks/workspace/panel-registry';

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
   * but whose catalog entry could not be pruned, or a registration whose
   * repository could not be read. The action succeeded and the payload is
   * current; the pane would otherwise report the leftover state with no hint of
   * where it came from.
   */
  warning?: string;
  payload?: PanelRegistryPayload;
}

export interface PanelPluginActions {
  /** The action in flight, so a row can show which one is running. */
  busy: string | null;
  error: string | null;
  clearError: () => void;
  /**
   * Install from a git URL, GitHub's `owner/repo` shorthand, or the NAME of a
   * plugin a registered repository offers.
   *
   * The name form is why the repository naming rule is usable: the repository
   * carries `kabmo-plugins-`, the plugin the user installs does not.
   */
  install: (spec: string) => Promise<boolean>;
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
  /** Bring one installed plugin up to its source — a remote, or the store's copy. */
  update: (pluginId: string) => Promise<boolean>;
  /** Apply every update that is available, in one pass. */
  updateAll: () => Promise<boolean>;
  /** Turn automatic updating of git-installed plugins on or off. */
  setAutoUpdate: (enabled: boolean) => Promise<boolean>;
  /** Replace a blocked bundled plugin's edited files with the store's copy. */
  forceSync: (pluginId: string) => Promise<boolean>;
  /** Register a GitHub plugin repository in `marketplace.json`. */
  registerRegistry: (repo: string) => Promise<boolean>;
  /** Drop a registration; installed plugins and their files stay. */
  removeRegistry: (repo: string) => Promise<boolean>;
  /** Re-read one registration, or every registration. */
  refreshRegistry: (repo?: string) => Promise<boolean>;
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
    // the pane re-reads — but the reason surfaces, because the leftover state it
    // names shows up as a row right below.
    if (result.warning) setError(result.warning);
    // Every consumer re-reads from the response, not from a second fetch — the
    // server's own republish of the `panels` topic follows, and both carry the
    // same payload.
    if (result.payload) seedPanelRegistry(result.payload);
    return true;
  }, []);

  const install = useCallback((spec: string) => run('install', { type: 'install', spec }), [run]);
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
  const update = useCallback((pluginId: string) => run(`update:${pluginId}`, { type: 'update', pluginId }), [run]);
  const updateAll = useCallback(() => run('update_all', { type: 'update_all' }), [run]);
  const setAutoUpdate = useCallback(
    (enabled: boolean) => run('set_auto_update', { type: 'set_auto_update', enabled }),
    [run],
  );
  const forceSync = useCallback((pluginId: string) => run(`force_sync:${pluginId}`, { type: 'force_sync', pluginId }), [run]);
  const registerRegistry = useCallback(
    (repo: string) => run(`register_registry:${repo}`, { type: 'register_registry', repo }),
    [run],
  );
  const removeRegistry = useCallback(
    (repo: string) => run(`remove_registry:${repo}`, { type: 'remove_registry', repo }),
    [run],
  );
  const refreshRegistry = useCallback(
    (repo?: string) => run(repo ? `refresh_registry:${repo}` : 'refresh_registry', { type: 'refresh_registry', ...(repo ? { repo } : {}) }),
    [run],
  );

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
    update,
    updateAll,
    setAutoUpdate,
    forceSync,
    registerRegistry,
    removeRegistry,
    refreshRegistry,
  };
}
