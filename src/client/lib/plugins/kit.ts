/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Wiring the UI kit to the chamber's own services.
 *
 * `@ompchamber/ui` is a published package, so it cannot import the chamber's
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

import { configureUiKit, type PluginRpcOutcome } from '@ompchamber/ui';
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

/**
 * Read a text file inside the active workspace, through the chamber's own fs
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
    // The chamber's markdown renderer, so a plugin does not bundle a second
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
  });
}
