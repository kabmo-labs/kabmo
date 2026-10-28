/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The attribute that confines a plugin's CSS to its own DOM.
 *
 * A plugin's stylesheet is loaded into the HOST's document — there is no iframe
 * and no shadow root — so without a boundary every rule it writes applies to
 * the whole app. That was the leak: `html[data-my-plugin] .code-block::before`
 * (the pattern this SDK used to recommend) selects the app's own code blocks,
 * because `html[…]` is an ancestor of everything, not a scope.
 *
 * The boundary is one attribute, and it is the SAME name and the SAME value on
 * every surface a plugin's code renders into:
 *
 * - a slot component's wrapper (the kit's `PluginIdProvider`), and
 * - a content script's root element (handed to it as `ContentScriptContext.root`).
 *
 * The value is the plugin id, which is also what the server wraps the plugin's
 * stylesheet in: `@scope ([data-plugin-surface="<id>"]) { … }`. So the
 * selector, the attribute and the id are one contract with one definition —
 * the server, the kit and the host all read it from here rather than each
 * spelling the string out.
 *
 * Two properties are load-bearing:
 *
 * - **The attribute is an attribute, not a class.** A class is something a
 *   plugin could add to a host element by accident; the attribute is written by
 *   the host only, on an element the host created.
 * - **A plugin id is safe inside a quoted attribute selector.** The manifest
 *   grammar (`/^[a-z0-9][a-z0-9._-]{0,63}$/i`) admits no quote, no backslash and
 *   no `]`, so the id needs no escaping to be a valid selector value.
 */

/** The attribute every element a plugin's own DOM lives in carries. */
export const PLUGIN_SURFACE_ATTR = 'data-plugin-surface';

/**
 * The selector a plugin's stylesheet is scoped under, for `pluginId`.
 *
 * Built here rather than at each call site so the server's `@scope` prelude and
 * anything that has to match the same element cannot disagree.
 */
export function pluginSurfaceSelector(pluginId: string): string {
  // Defensive, not required: the manifest grammar already refuses a quote. A
  // caller outside the manifest path (a test, a future surface) would otherwise
  // be able to close the attribute and escape the scope.
  const safe = pluginId.replace(/["\\]/g, '\\$&');
  return `[${PLUGIN_SURFACE_ATTR}="${safe}"]`;
}
