/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The plugin-identity context: which plugin's UI a subtree belongs to.
 *
 * It lives in the KIT, not in the host, because both ends must share one
 * instance: the host imports `@ompchamber/ui` directly while a plugin bundle
 * gets the same module through `globalThis.__ompchamberPluginRuntime.ui`, so a
 * `Provider` the host renders is the `Provider` a plugin's hook reads.
 *
 * A Preact context rather than a module-level value, and that is a correctness
 * point rather than a style choice: a component's children render AFTER its own
 * function returns, so a value set and restored around `return <>{children}</>`
 * is already gone by the time the children run. Measured — `setId('outer')` in
 * a `try/finally` left the children reading `null`.
 *
 * The id is what makes `useRpc('save')` safe: the hook takes the plugin from
 * here, so a component rendered for plugin A can never address plugin B's
 * namespace, however the caller names its method.
 */

import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { ComponentChildren } from 'preact';

const PluginIdContext = createContext<string | null>(null);

/**
 * Wrap a plugin's own UI so its hooks resolve the right plugin.
 *
 * Every host surface that draws a plugin row wraps it — the right panel, the
 * editor column, a chat row's actions, the composer's slots. A surface that
 * forgot would leave its plugin's `useRpc` answering `no_plugin`, which is the
 * loud failure rather than the silent one (a call landing in another plugin).
 */
export function PluginIdProvider({ pluginId, children }: { pluginId: string; children?: ComponentChildren }) {
  return <PluginIdContext.Provider value={pluginId}>{children}</PluginIdContext.Provider>;
}

/** The plugin whose subtree this is, or null outside any plugin's UI. */
export function usePluginId(): string | null {
  return useContext(PluginIdContext);
}
