/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The repo scope, as the UI kit's services see it.
 *
 * The kit cannot read the shared pick through its own session services: those
 * carry a `plugin.` prefix so a plugin's keys live in its own namespace, and
 * `workspace.activeRepo` is the HOST's slot. So the host exposes it here, over
 * the two things its own four panels already share — the session slot and the
 * repo discovery store.
 *
 * Three rules, each of which is a bug if dropped:
 *
 * - **The stored value is a `{ root, repo }` PAIR, and a pair from another root
 *   is not this root's pick.** The slot is per session, so a session that picked
 *   a repo and was then moved to another workspace still holds the old value; a
 *   bare read would hand a plugin a path that does not exist under the root it
 *   is describing.
 * - **A subscription fires for a SESSION change as well as a pick.** The value
 *   lives in per-session state, so switching sessions changes the effective
 *   scope while the stored key is untouched — a subscriber wired only to the key
 *   would keep reporting the previous session's repo.
 * - **The root comes from the plugin context**, which is the same value a panel
 *   body carries. One resolution serves both a panel (a component) and a content
 *   script (no component), so the two cannot disagree about which tree they mean.
 */

import type { RepoScope, RepoScopeRow, UiKitServices } from '@kabmo-labs/kabmo-ui';
import { getSessionValue, setSessionKey } from '@/shared/lib/workspace/session-state/store';
import { subscribeSessionKey } from '@/shared/lib/workspace/session-state/listeners';
import { pluginContext, subscribePluginContext } from '@/client/lib/plugins/context';
import { repoStore, UNKNOWN_LIST } from '@/client/hooks/workspace/repo-scope/store';
import { REPO_SCOPE_STATE_KEY } from '@/client/hooks/workspace/repo-scope';
import { repoLabel, repoShortLabel } from '@/shared/lib/fs/repo-label';

/** A repo choice, kept next to the workspace root it was made under. */
interface RepoPick {
  root: string;
  repo: string;
}

/**
 * The choices, as rows.
 *
 * The labels are computed HERE because the naming rule is the host's: the root
 * reads as its folder's name, a list row keeps its whole root-relative path so
 * `jns6_5/token` and `jns7/token` are distinguishable, and a trigger truncates
 * to the last segment. The kit is a published package that cannot import
 * `repo-label`, and a second copy of those rules is how one repo comes to be
 * labelled two ways in two places.
 *
 * `'.'` always leads: the root is a legitimate choice even when it is not itself
 * a repository, because a folder of nested repos is a normal workspace.
 */
function rowsFor(root: string, repos: readonly string[]): RepoScopeRow[] {
  const rest = repos.filter((repo) => repo !== '.');
  return ['.', ...rest].map((repo) => ({
    repo,
    label: repoLabel(repo, root),
    short: repoShortLabel(repo, root),
  }));
}

/**
 * The scope as it stands.
 *
 * Reads the discovery store directly rather than through a hook: this runs
 * outside a component (a content script calls it too), and the store is the same
 * one `useRepoList` reads.
 */
function readRepoScope(): RepoScope {
  const { sessionId, workspacePath } = pluginContext();
  const pick = getSessionValue<RepoPick | null>(sessionId, REPO_SCOPE_STATE_KEY);
  const snapshot = workspacePath ? repoStore.snapshot(workspacePath) : UNKNOWN_LIST;
  return resolveRepoScope(workspacePath, pick, snapshot.repos, snapshot.scanning);
}

/**
 * The scope, from its three inputs — pure, so the rules can be tested without a
 * session, a store or a socket.
 *
 * Both rules here are load-bearing and each was a bug shape first:
 *
 * - **No workspace means no scope**, reported as `root: null` rather than as a
 *   root of `''`. A panel that treated an empty root as a real one would send
 *   `root: ''` to the server, which resolves it to the process's cwd.
 * - **A pick from another root is not this root's pick.** The slot is per
 *   session, so a session that picked a repo and was then pointed at another
 *   workspace still holds the old pair; the fallback is the workspace root.
 */
export function resolveRepoScope(
  root: string | null,
  pick: RepoPick | null | undefined,
  repos: readonly string[],
  scanning: boolean,
): RepoScope {
  if (!root || root.length === 0) {
    return { root: null, repo: '.', rows: [], scanning: false, ready: false };
  }
  const repo =
    pick && typeof pick === 'object' && pick.root === root && typeof pick.repo === 'string' && pick.repo
      ? pick.repo
      : '.';
  return { root, repo, rows: rowsFor(root, repos), scanning, ready: true };
}

/**
 * The kit's repo-scope services.
 *
 * `subscribeRepoScope` fans in BOTH signals under one unsubscribe: the pick's own
 * slot bus, and the plugin context (a session or workspace change). It also
 * starts the root's discovery, which is what the panels' own hook does — the
 * store subscribes to the root's topic on the first listener, so a plugin that
 * opens a picker is what triggers the walk.
 */
export function repoScopeServices(): Pick<
  UiKitServices,
  'repoScope' | 'setRepoScope' | 'subscribeRepoScope' | 'rescanRepoScope'
> {
  return {
    repoScope: readRepoScope,
    setRepoScope: (repo) => {
      const { sessionId, workspacePath } = pluginContext();
      if (!workspacePath) return;
      setSessionKey(sessionId, REPO_SCOPE_STATE_KEY, { root: workspacePath, repo } satisfies RepoPick);
    },
    subscribeRepoScope: (listener) => {
      const { sessionId, workspacePath } = pluginContext();
      const offPick = subscribeSessionKey(sessionId, REPO_SCOPE_STATE_KEY, listener);
      const offContext = subscribePluginContext(listener);
      // The discovery store only holds a topic open while it has a listener, so
      // subscribing here is what makes the list arrive for a plugin picker.
      const offRepos = workspacePath ? repoStore.subscribe(workspacePath, listener) : () => {};
      return () => {
        offPick();
        offContext();
        offRepos();
      };
    },
    rescanRepoScope: () => {
      const { workspacePath } = pluginContext();
      if (workspacePath) repoStore.rescan(workspacePath);
    },
  };
}
