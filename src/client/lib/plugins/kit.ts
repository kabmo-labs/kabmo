/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Wiring the UI kit to Kabmo's own services.
 *
 * `@kabmo-labs/kabmo-ui` is a published package, so it cannot import Kabmo's
 * source. This module is the host half of that seam: it hands the kit the few
 * services a plugin genuinely cannot reach itself, and it is called ONCE at
 * boot, before any plugin component can mount.
 *
 * Every service here is something a plugin could not do on its own:
 *
 * - the per-session store lives in a module singleton with its own persistence
 *   and eviction, so a plugin reading `localStorage` would get a different
 *   answer that survives the wrong things;
 * - the palette id is written by the theme hook and announced by an event, so a
 *   plugin cannot observe it from CSS alone;
 * - the active workspace is resolved from the session's project, not from the
 *   URL.
 */

import { configureUiKit, type PluginRpcOutcome } from '@kabmo-labs/kabmo-ui';
import { getSessionValue, setSessionKey } from '@/shared/lib/workspace/session-state/store';
import { subscribeSessionKey } from '@/shared/lib/workspace/session-state/listeners';
import { pluginContext, subscribePluginContext } from '@/client/lib/plugins/context';
import { MarkdownRenderer } from '@/client/components/common/MarkdownRenderer';
import { pluginRpcPath } from '@/shared/lib/plugins/protocol';
import { composerService, subscribeComposer } from '@/client/lib/plugins/composer-bridge';
import {
  pluginTopicStale,
  readPluginTopic,
  refreshPluginTopic,
  subscribePluginTopic,
} from '@/client/lib/plugins/topic';
import {
  refreshSidebarThreads,
  sidebarActions,
  sidebarThreads,
  subscribeSidebarThreads,
} from '@/client/lib/plugins/sidebar-bridge';
import { repoScopeServices } from '@/client/lib/plugins/repo-scope-service';
import { awaitPluginPlatformReady } from '@/client/lib/plugins/readiness';

/**
 * Read a text file inside the active workspace, through Kabmo's own fs
 * route.
 *
 * The route takes a root-relative path and enforces the browse scope, so a
 * plugin cannot name a file outside the workspace it was given — the check is
 * the server's, not a string test here.
 */
async function readWorkspaceFile(workspacePath: string | null, relativePath: string): Promise<string> {
  if (!workspacePath) throw new Error('No workspace folder is active.');
  const query = new URLSearchParams({ path: relativePath, root: workspacePath });
  const response = await fetch(`/api/fs/raw?${query}`, { credentials: 'same-origin' });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Could not read ${relativePath} (${response.status})`);
  }
  return response.text();
}

/**
 * Call one of the plugin's own server methods.
 *
 * The plugin id is the FIRST argument and the kit supplies it from the context
 * of the subtree the call was made in — so a plugin never names its own
 * namespace, and a component rendered for plugin A cannot call into plugin B.
 *
 * The answer is returned as the WIRE shape rather than thrown: the route
 * answers `{ ok: false, error }` at HTTP 200 for a plugin's own refusal, and
 * flattening that into a rejection would turn "the plugin said no" into "the
 * network broke" — the one distinction the route exists to preserve.
 */
async function callRpc(pluginId: string, method: string, input: unknown): Promise<PluginRpcOutcome> {
  if (!pluginId) return { ok: false, error: { code: 'no_plugin', message: 'No plugin is in scope.' } };
  const first = await callRpcOnce(pluginId, method, input);
  // A 404 on the route means no plugin by this id is loaded — and the console
  // reloads into a restarted server the moment `/api/health` reports a new
  // process, which is BEFORE that boot has imported its plugin halves. So the
  // first call of a freshly reloaded page can 404 against a server that is
  // still booting, and a caller cannot tell that apart from a plugin that is
  // not installed. `awaitPluginPlatformReady` answers the difference: only a
  // boot window it actually observed licenses the retry, so a 404 on a settled
  // server is returned as it stands. Measured after a restart, the Stats
  // header's `watch` 404'd 194 ms into the new page and its effect never
  // re-ran, so the readout stayed on `—` although the halves were up ~500 ms
  // later.
  if (first.ok || first.error.code !== 'plugin_not_loaded') return first;
  if ((await awaitPluginPlatformReady()) !== 'booted') return first;
  return callRpcOnce(pluginId, method, input);
}

/** One attempt, with the wire's answers mapped as the kit documents them. */
async function callRpcOnce(pluginId: string, method: string, input: unknown): Promise<PluginRpcOutcome> {
  const path = pluginRpcPath(pluginId, method);
  try {
    const response = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input ?? null),
    });
    const body = (await response.json().catch(() => null)) as PluginRpcOutcome | null;
    if (body && typeof body === 'object' && 'ok' in body) return body;
    // A 404 on the ROUTE (not a method the plugin answered) means no plugin by
    // this id is loaded on the server. That is the exact state a plugin
    // installed into a running Kabmo is in until its server half loads, and
    // naming it lets a panel say so instead of reporting "watch answered 404"
    // — which reads as a broken plugin rather than one that is not live yet.
    if (response.status === 404) {
      return {
        ok: false,
        error: { code: 'plugin_not_loaded', message: `no plugin "${pluginId}" is loaded on the server` },
      };
    }
    return { ok: false, error: { code: 'bad_response', message: `${method} answered ${response.status}` } };
  } catch (cause) {
    return {
      ok: false,
      error: { code: 'transport', message: cause instanceof Error ? cause.message : String(cause) },
    };
  }
}

/** Install the kit's services. Idempotent. */
export function installUiKit(): void {
  configureUiKit({
    context: pluginContext,
    subscribe: subscribePluginContext,
    getSessionValue: (sessionId, key) => {
      const stored = getSessionValue<unknown>(sessionId, `plugin.${key}`);
      return typeof stored === 'string' ? stored : null;
    },
    setSessionValue: (sessionId, key, value) => setSessionKey(sessionId, `plugin.${key}`, value),
    // The store's own per-slot bus, so a plugin's write reaches every OTHER
    // component reading that slot — a note field and a readout of its length are
    // two readers of one value, and without this the readout keeps whatever it
    // read at mount.
    subscribeSessionValue: (sessionId, key, listener) =>
      subscribeSessionKey(sessionId, `plugin.${key}`, listener),
    readWorkspaceFile,
    // The same store, untyped by the kit and narrowed by the caller — so a view
    // that keeps a collapsed-phase map is not JSON-encoding it into a string.
    getSessionJson: <T,>(sessionId: string | null, key: string) => getSessionValue<T>(sessionId, key),
    setSessionJson: (sessionId, key, value) => setSessionKey(sessionId, key, value),
    subscribeSessionJson: (sessionId, key, listener) => subscribeSessionKey(sessionId, key, listener),
    // The Kabmo's markdown renderer, so a plugin does not bundle a second
    // copy of the marked / KaTeX / mermaid / Shiki pipeline.
    markdown: () => MarkdownRenderer,

    // The participant seam: RPC, the plugin's own topic, and the composer.
    // The id arrives as an ARGUMENT, supplied by the kit hook from the context
    // of the subtree it was called in — never resolved here, because this
    // module cannot see which component is rendering.
    callRpc,
    subscribePluginTopic,
    readPluginTopic,
    refreshPluginTopic,
    pluginTopicStale,
    composer: composerService,
    subscribeComposer,

    // The sidebar: a projection of the host's own sidebar topic, and the
    // session writes that go through the host's own routes.
    sidebarThreads,
    subscribeSidebarThreads,
    refreshSidebarThreads,
    sidebarActions,

    // The nested-repo scope the four browsing panels share. Exposed as a service
    // because the kit's own session services are namespaced under `plugin.`, so
    // the host's shared slot is unreachable from them — and because the value is
    // a `{ root, repo }` pair that only the host can resolve.
    ...repoScopeServices(),
  });
}
