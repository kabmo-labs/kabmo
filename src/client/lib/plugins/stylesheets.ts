/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A plugin's stylesheet, loaded while it has a live content-script generation.
 *
 * This is the second half of `contentScripts`, and it exists because a plugin's
 * imported CSS is otherwise INERT: `Bun.build` emits it beside the bundle and
 * the emitted JS never references it, so nothing fetches it. The manifest
 * declares it and the host loads it here.
 *
 * The lifecycle is deliberately tied to the CONTENT-SCRIPT generation rather
 * than to a slot being rendered, because that is what bb does and it is the
 * honest scope: a plugin that ships an app-shell stylesheet needs it exactly
 * while its app-shell code is mounted. A plugin with no content scripts gets no
 * stylesheet — it renders in the host's document with the host's own utilities,
 * which is the documented path and needs no CSS of its own.
 *
 * Two properties are load-bearing:
 *
 * - **The URL carries a content hash, so a `<link>` per URL is cached by the
 *   browser and re-adding one is a no-op.** A rebuilt plugin reaches a new URL,
 *   so the old link is replaced rather than reused — that is what makes a
 *   rebuild show new rules instead of the ones the browser already had.
 * - **Unloading removes the element.** A plugin that is disabled, removed or
 *   whose generation went away must stop styling the document; leaving the
 *   `<link>` in place would let a switched-off plugin keep affecting the app.
 */

/** The `<link>` a plugin's stylesheet is loaded through, keyed by plugin id. */
const loaded = new Map<string, HTMLLinkElement>();

/** The attribute the host marks its own plugin links with, so it can find them. */
const LINK_ATTR = 'data-plugin-stylesheet';

/**
 * Load `url` for `pluginId`, replacing whatever that plugin had loaded.
 *
 * A different URL for the same plugin is a rebuild: the previous link is
 * removed first, so the document never carries two versions of one plugin's
 * rules at once (CSS is not scoped, so the later one would not reliably win).
 */
export function loadPluginStylesheet(pluginId: string, url: string): void {
  const existing = loaded.get(pluginId);
  if (existing?.dataset.url === url) return;
  if (existing) existing.remove();

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = url;
  link.setAttribute(LINK_ATTR, pluginId);
  // The URL is content-addressed, so remembering which URL a link carries is
  // how a re-apply of the SAME url is told from a rebuild's new one.
  link.dataset.url = url;
  document.head.appendChild(link);
  loaded.set(pluginId, link);
}

/** Remove `pluginId`'s stylesheet, if one is loaded. */
export function unloadPluginStylesheet(pluginId: string): void {
  loaded.get(pluginId)?.remove();
  loaded.delete(pluginId);
}

/**
 * Load exactly the stylesheets named, and unload every other plugin's.
 *
 * The reconciling form the bootstrap effect uses: the registry payload is the
 * whole truth about which plugins are live, so a plugin that disappeared from
 * it — disabled, removed, or failed to load — must lose its stylesheet in the
 * same pass that gives a new one its own.
 */
export function reconcilePluginStylesheets(entries: ReadonlyArray<{ pluginId: string; cssUrl?: string }>): void {
  const wanted = new Map<string, string>();
  for (const entry of entries) {
    if (entry.cssUrl) wanted.set(entry.pluginId, entry.cssUrl);
  }
  for (const pluginId of [...loaded.keys()]) {
    if (!wanted.has(pluginId)) unloadPluginStylesheet(pluginId);
  }
  for (const [pluginId, url] of wanted) loadPluginStylesheet(pluginId, url);
}

/** Test seam: forget every link without touching the document. */
export function resetPluginStylesheets(): void {
  loaded.clear();
}
