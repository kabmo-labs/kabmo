/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The scope watcher: stop every run whose repo the user just left.
 *
 * ## Why a content script, and not the panel
 *
 * A plugin panel is UNMOUNTED while another view is on screen — the desktop
 * stack keeps the built-in views mounted and hidden, a plugin is not. So a repo
 * switch made from the Files panel would leave this plugin's processes running
 * with no watcher alive. A content script mounts for as long as the plugin is
 * ENABLED, whatever panel is shown, and that is the only place the switch can be
 * observed. This is the one piece of the plugin that is not "right panel only",
 * and it renders nothing.
 *
 * ## It does not detect a CHANGE
 *
 * `stop-others` is defined by the scope it is handed: it kills this session's
 * runs in any OTHER scope and leaves the current one alone. So calling it on
 * every notification — and once at mount — is idempotent. That removes the one
 * piece of state a watcher would otherwise have to keep (the previous scope) and
 * the ordering questions that come with it, and it makes a missed notification
 * self-healing rather than permanent.
 *
 * ## It uses the SERVICES, never the hooks
 *
 * `useRepoScope()` needs a Preact component and this is not one. The services
 * are reachable from anywhere in the host's tree (`uiKitServices()`), and the
 * plugin id it needs comes from its own `mount(context)` argument rather than
 * from `usePluginId()`. Against a host too old to provide the repo scope, the
 * watcher does nothing — the panel's own mount sweep is then the net.
 */

import { uiKitServices } from '@kabmo-labs/kabmo-ui';
import type { ContentScriptContext } from '@kabmo-labs/kabmo-sdk';

import { RPC } from './protocol';

/** Ask the server to stop this session's runs in any scope but the current one. */
export async function stopOtherScopes(pluginId: string, scope: { root: string; repo: string }, sessionId: string | null): Promise<void> {
  const services = uiKitServices();
  if (!services?.callRpc) return;
  const outcome = await services.callRpc(pluginId, RPC.stopOthers, {
    root: scope.root,
    repo: scope.repo,
    sessionId,
  });
  if (!outcome.ok) {
    // Reported rather than swallowed: a sweep that never ran is a process the
    // user believes is stopped.
    console.error(`[command-runner] stop-others refused: ${outcome.error.message}`);
  }
}

/**
 * Mount the watcher.
 *
 * Returns a disposer that drops both subscriptions, which the host calls on
 * reload, disable and removal — a leaked listener would fire against a plugin
 * that is no longer loaded.
 */
export function mountScopeWatch(context: ContentScriptContext): () => void {
  const services = uiKitServices();
  if (!services?.repoScope || !services.subscribeRepoScope) {
    // A host without the repo scope: nothing to watch, and the panel's own sweep
    // still covers the case where someone is looking at it.
    return () => {};
  }

  /** Sweep against whatever the scope is NOW. */
  const sweep = (): void => {
    const scope = services.repoScope?.();
    if (!scope?.root) return;
    const { sessionId } = services.context();
    void stopOtherScopes(context.pluginId, { root: scope.root, repo: scope.repo }, sessionId);
  };

  // Once at mount, then on every scope or session change. The subscription
  // covers both (the host fans them in), which matters because the slot is
  // per-session: switching sessions changes the effective scope while the stored
  // key is untouched.
  sweep();
  const off = services.subscribeRepoScope(sweep);

  // The window's own teardown, so a script that outlives a `pagehide` does not
  // leave a listener behind. The host also calls the returned disposer.
  const onUnload = () => off();
  window.addEventListener('pagehide', onUnload);

  return () => {
    off();
    window.removeEventListener('pagehide', onUnload);
  };
}
