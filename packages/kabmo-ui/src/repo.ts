/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The repo scope, as a plugin reads and writes it.
 *
 * A nested repository is a path RELATIVE to the active workspace root
 * (`projects/api` names a directory under the root), so the choice and the
 * discovered list are both meaningless without the root they belong to. The host
 * keeps the pairing; this module is the plugin's view of it.
 *
 * Two properties the hooks exist to enforce:
 *
 * - **The value arrives late and changes from elsewhere.** The stored pick loads
 *   with the session, and the four host panels write the same slot. A component
 *   that captured the scope once would show the previous repo forever, so the
 *   hook subscribes and re-renders.
 * - **A pick made under another root is not this root's pick.** The service
 *   resolves that (it is the host that holds both halves), so a plugin never has
 *   to compare roots itself.
 *
 * Against a host too old to provide the service, the hook reports an empty scope
 * rather than throwing: a plugin that renders a picker against a host without
 * one should draw "no workspace", not break the panel.
 */

import { useCallback, useEffect, useState } from 'preact/hooks';
import { requireServices, type RepoScope } from './services';

/** The scope with nothing known yet, for a host that cannot answer. */
const NO_SCOPE: RepoScope = { root: null, repo: '.', rows: [], scanning: false, ready: false };

export interface RepoScopeHandle extends RepoScope {
  /** Set the shared pick. */
  setRepo(repo: string): void;
  /** Force a fresh nested-repo walk for the current root. */
  refresh(): void;
}

/**
 * The nested-repo scope the workspace panels share.
 *
 * Takes NO root argument: the service resolves the root from the plugin context
 * the host already publishes, which is the same value a panel body carries. That
 * is deliberate — one resolution serves both a panel (which has a component to
 * call a hook from) and a content script (which does not), so the two cannot
 * disagree about which tree they are describing.
 */
export function useRepoScope(): RepoScopeHandle {
  const [scope, setScope] = useState<RepoScope>(() => requireServices().repoScope?.() ?? NO_SCOPE);

  useEffect(() => {
    const api = requireServices();
    const read = () => setScope(api.repoScope?.() ?? NO_SCOPE);
    // Re-read once on mount: the first render may have run before the session's
    // stored state loaded, and the subscription only fires on a CHANGE.
    read();
    return api.subscribeRepoScope?.(read);
  }, []);

  const setRepo = useCallback((repo: string) => {
    requireServices().setRepoScope?.(repo);
  }, []);

  const refresh = useCallback(() => {
    requireServices().rescanRepoScope?.();
  }, []);

  return { ...scope, setRepo, refresh };
}
