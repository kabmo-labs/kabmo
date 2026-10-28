/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `GET /api/plugins` — the plugin platform's state, for the settings pane.
 *
 * What it answers is deliberately narrow: which plugins have a server half
 * LOADED, and which failed to load with what reason. The catalog itself (what
 * is installed, enabled, built) is `/api/panels`, and duplicating it here would
 * be a second source of truth for the same question — the two would disagree
 * the moment one of them was cached.
 *
 * The reason a load failed is the whole point of the endpoint: a plugin whose
 * server half threw has a working panel and a dead backend, and without this
 * the only symptom is a method that answers 404.
 */

import { json, type LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { pluginLoadErrors, loadedPluginIds } from '@/server/lib/plugins/loader.server';
import { hasRpcMethods } from '@/server/lib/plugins/rpc.server';

export async function loader(_args: LoaderFunctionArgs) {
  const loaded = loadedPluginIds();
  return json(
    {
      loaded,
      errors: pluginLoadErrors(),
      // A plugin with no methods is a normal state (it may own only a topic or
      // a schedule), so this is a capability report rather than a status.
      withRpc: loaded.filter((id) => hasRpcMethods(id)),
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
