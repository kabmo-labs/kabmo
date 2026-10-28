/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Nested-repo scope for the right-panel views (files, search, git, terminal).
 *
 * Every one of them needs the same two things, and both are meaningless without
 * the workspace root they describe:
 *
 *   - WHICH repo the view operates on (`useRepoScope`). A repo is a path
 *     relative to the active root — `projects/jns6_5/token` only names a
 *     directory under `~/JatisMobile/Workspace` — so a choice is only valid
 *     next to the root it was made under.
 *   - WHAT repos exist under that root (`useRepoList`), discovered server-side
 *     and stored with the root it was discovered for (see `./store`).
 *
 * Kept as bare per-panel values, both outlived the workspace they belonged to:
 * after a workspace switch the picker still listed the previous workspace's
 * repos, still showed one of them as the selection, and every request the panel
 * made named a path that did not exist under the new root. Pairing each value
 * with its root invalidates it by construction — no reset effect to order
 * against the per-session state restore — while a session returned to inside
 * the same workspace keeps the repo it was left on.
 *
 * The choice is also ONE value for all four views (`REPO_SCOPE_STATE_KEY`), not
 * one per panel: they describe the same working tree, so a repo picked in the
 * file explorer has to move the search scope, the Source Control view and a
 * terminal's cwd with it. Per-panel keys meant four pickers that could silently
 * disagree about which repository was on screen.
 */

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'preact/compat';
import { useSessionStateContext } from '@/client/hooks/workspace/session-state/context';
import { useSharedSessionState } from '@/client/hooks/workspace/session-state';
import { clearSessionKey, getSessionValue } from '@/shared/lib/workspace/session-state/store';
import { repoStore, UNKNOWN_LIST } from '@/client/hooks/workspace/repo-scope/store';

/** A repo choice, kept next to the workspace root it was made under. */
interface RepoPick {
  root: string;
  repo: string;
}

/**
 * The one slot the selected repo lives in, shared by every right-panel view that
 * browses a repository (files, search, git, terminal).
 *
 * One slot rather than one per panel: the views all describe the same working
 * tree, so picking a repo in any of them must move the rest — otherwise the
 * Files tree, the search scope, the Source Control view and a terminal's cwd can
 * disagree about which repository they are showing, with nothing on screen
 * saying why.
 */
export const REPO_SCOPE_STATE_KEY = 'workspace.activeRepo';

/**
 * Keys that held the pick before the views shared one selection, in the order a
 * session carrying several is read. The git panel's value wins: that pick is the
 * one the repo list's root-level fallback and the Source Control indicator were
 * built around.
 */
const LEGACY_REPO_STATE_KEYS = ['git.activeRepo', 'files.activeRepo', 'search.activeRepo', 'terminal.activeRepo'];

/**
 * The repo a git panel works on: the user's pick, or — when they have none and
 * the workspace root is not itself a repo — the first repo discovery found.
 *
 * The git loader applies the same fallback when it is sent no repo at all
 * (`repo = repos.includes('.') ? '.' : repos[0]`), so resolving it here is what
 * keeps the header label, the picker's checkmark and the requests all naming
 * the repo git is actually operating on. Only git resolves it: browsing the
 * workspace root is legitimate even when that root is not a repo — a folder of
 * nested repos is a normal workspace — so the files, search and terminal panels
 * keep `'.'` as the root itself.
 */
export function resolveRepoForPanel(pick: string, repos: readonly string[]): string {
  if (pick !== '.' || repos.includes('.')) return pick;
  return repos[0] ?? '.';
}

/**
 * The repo the right panel works on, restored per session but dropped the moment
 * the active workspace root changes.
 *
 * The pick is read SHARED (`useSharedSessionState`), not from a private copy:
 * every view that shows a repo picker reads this one value, and a surface that
 * only follows it — the activity bar's Source Control dot, the phone's tab bar —
 * has no picker at all. A per-instance copy left those on the previous repo.
 */
export function useRepoScope(rootPath: string | undefined): {
  activeRepo: string;
  setActiveRepo: (repo: string) => void;
  ready: boolean;
} {
  const { sessionId } = useSessionStateContext();
  const [pick, setPick, ready] = useSharedSessionState<RepoPick | null>(REPO_SCOPE_STATE_KEY, null);
  const scope = rootPath ?? '';

  // Read through refs so the setter keeps ONE identity: it is handed to child
  // components and used in effect dependencies, and `useSessionState` mints a
  // fresh setter per render.
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const setPickRef = useRef(setPick);
  setPickRef.current = setPick;
  const setActiveRepo = useCallback((repo: string) => {
    setPickRef.current({ root: scopeRef.current, repo });
  }, []);

  // A session that picked a repo while the panels kept their own keys still has
  // it under its own panel's: adopt it, then leave one key behind. Clearing is
  // unconditional — a legacy value that does not match this root names a
  // directory the shared slot could not use anyway.
  useEffect(() => {
    if (!ready) return;
    if (!pick) {
      const adopted = LEGACY_REPO_STATE_KEYS
        .map((key) => getSessionValue<RepoPick | null>(sessionId, key))
        .find((candidate) => candidate && candidate.root === scope && candidate.repo);
      if (adopted) setPickRef.current(adopted);
    }
    for (const key of LEGACY_REPO_STATE_KEYS) clearSessionKey(sessionId, key);
  }, [ready, pick, scope, sessionId]);

  // A pick made under another root (or stored before the root was recorded
  // alongside it) names a directory that need not exist here: fall back to the
  // workspace root.
  const activeRepo =
    pick && typeof pick === 'object' && pick.root === scope && typeof pick.repo === 'string' && pick.repo
      ? pick.repo
      : '.';

  return { activeRepo, setActiveRepo, ready };
}

/**
 * The repo a panel's picker resolves to right now, for the surfaces that follow
 * the shared scope without owning a picker — the Source Control dot in the
 * activity bar and the phone's tab bar. Same pick, same list, same fallback as
 * the panel's own reads, so the dot describes the repository its view would show.
 */
export function useResolvedRepo(rootPath: string | undefined, active: boolean): string {
  const { activeRepo } = useRepoScope(rootPath);
  const { repos } = useRepoList(rootPath, active);
  return resolveRepoForPanel(activeRepo, repos);
}

export interface RepoListHandle {
  /** Repos of the active root; the workspace root alone until discovery answers. */
  repos: string[];
  /** Discovery is still running — the server said so, or a rescan is in flight. */
  scanning: boolean;
  /** Re-run discovery from scratch (the picker's refresh button). */
  rescan: () => void;
}

/**
 * Discovered repos of the active root.
 *
 * @param active - when false nothing is subscribed; a hidden panel has no use
 *   for a list that costs the server a `find` over the workspace.
 */
export function useRepoList(rootPath: string | undefined, active: boolean): RepoListHandle {
  const scope = rootPath ?? '';
  const subscribe = useCallback(
    (listener: () => void) => (active ? repoStore.subscribe(scope, listener) : () => {}),
    [scope, active],
  );
  const getSnapshot = useCallback(
    () => (active ? repoStore.snapshot(scope) : UNKNOWN_LIST),
    [scope, active],
  );
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);
  const rescan = useCallback(() => {
    if (active) repoStore.rescan(scope);
  }, [scope, active]);

  return { repos: snapshot.repos, scanning: snapshot.scanning, rescan };
}
