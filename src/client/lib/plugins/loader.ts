/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Loading plugin bundles into the page.
 *
 * A plugin's bundle is a real ESM module served from the marketplace, so the
 * host loads it with a dynamic `import()` of its own URL. That is the whole
 * mechanism — there is no sandbox, no message channel and no separate realm,
 * which is exactly what lets a plugin render components into the host's tree.
 *
 * Two properties are load-bearing:
 *
 * - **A bundle is imported ONCE.** The browser caches a module by URL, so a
 *   second `import()` of the same URL returns the first evaluation and never
 *   re-runs `setup` — which is correct (a plugin's registrations must not
 *   double) but means a REBUILT plugin needs a different URL. The server
 *   includes the build's content hash in the URL for that reason.
 * - **A failed plugin is reported, not skipped.** A bundle that 404s, throws on
 *   evaluation or exports the wrong shape leaves a reason in the slot store, and
 *   the settings pane renders it. Silence would read as "this plugin contributes
 *   nothing", which is the one thing a user cannot debug.
 */

import { failPluginBundle, registerPluginBundle } from '@/client/lib/plugins/slots';

/** One plugin the host should load. */
export interface PluginBundleRef {
  pluginId: string;
  /** Absolute URL of the plugin's ESM bundle. */
  url: string;
}

/** URLs already imported, so a re-render cannot import the same bundle twice. */
const imported = new Set<string>();

/**
 * Import every bundle that has not been loaded yet.
 *
 * Sequential rather than concurrent: `setup` may register into shared stores,
 * and a deterministic order makes a failure reproducible. The list is short
 * (a handful of plugins) and each import is a cached fetch after the first.
 */
export async function loadPluginBundles(bundles: readonly PluginBundleRef[]): Promise<void> {
  for (const bundle of bundles) {
    if (imported.has(bundle.url)) continue;
    imported.add(bundle.url);
    try {
      // Dynamic on purpose, and the only place in this app that is: the URL is
      // a runtime-selected plugin bundle from the marketplace, so there is no
      // specifier a static import could name. Everything else uses static
      // imports.
      const module = await import(bundle.url);
      registerPluginBundle(bundle.pluginId, module);
    } catch (error) {
      failPluginBundle(bundle.pluginId, error instanceof Error ? error.message : String(error));
    }
  }
}

/** Forget what was imported — used by tests, and by a forced reload. */
export function resetLoadedBundles(): void {
  imported.clear();
}
