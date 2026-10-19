/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The plugin-identity context: which plugin's UI a subtree belongs to, AND the
 * DOM surface that plugin's stylesheet is confined to.
 *
 * It lives in the KIT, not in the host, because both ends must share one
 * instance: the host imports `@kabmo-labs/ui` directly while a plugin bundle
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
 *
 * The ELEMENT is the other half, and it is why this component renders a node
 * rather than only a context. A plugin's stylesheet is served wrapped in
 * `@scope ([data-plugin-surface="<id>"])` (see the server's css route), so a
 * rule the plugin writes reaches only elements inside a surface carrying its
 * own id. Without this element a plugin's own CSS would match nothing at all,
 * and the pattern it replaced — marking `<html>` — matched the HOST's chrome
 * too, which is the leak this closes.
 */

import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { PLUGIN_SURFACE_ATTR } from '@kabmo-labs/plugin-sdk';

const PluginIdContext = createContext<string | null>(null);

/**
 * Wrap a plugin's own UI so its hooks resolve the right plugin and its CSS has
 * a surface to land on.
 *
 * Every host surface that draws a plugin row wraps it — the right panel, the
 * editor column, a chat row's actions, the composer's slots, a timeline
 * renderer, a file view, the navbar. A surface that forgot would leave its
 * plugin's `useRpc` answering `no_plugin` (the loud failure) AND its stylesheet
 * inert (the silent one).
 *
 * `display: contents` is load-bearing: the wrapper must not become a flex item,
 * a grid item or a block that changes the host's layout. It generates no box,
 * so the plugin's own root behaves exactly as it did before this element
 * existed, while the element itself is still a real DOM node for the CSS scope
 * to root at.
 *
 * It is a `<span>` rather than a `<div>` for the same reason it carries
 * `display: contents`: a host surface may render a plugin row inside a
 * `<button>` (the navbar trigger), a `<label>` or a `<p>`, where only phrasing
 * content is valid. Since the element generates no box, the tag name costs
 * nothing.
 */
export function PluginIdProvider({ pluginId, children }: { pluginId: string; children?: ComponentChildren }) {
  return (
    <PluginIdContext.Provider value={pluginId}>
      <span data-plugin-surface={pluginId} style="display: contents">
        {children}
      </span>
    </PluginIdContext.Provider>
  );
}

/** The plugin whose subtree this is, or null outside any plugin's UI. */
export function usePluginId(): string | null {
  return useContext(PluginIdContext);
}

/** The attribute a plugin's surface element carries — re-exported for the host. */
export { PLUGIN_SURFACE_ATTR };
