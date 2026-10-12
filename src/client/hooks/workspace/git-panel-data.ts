import { useCallback, useEffect, useRef } from 'preact/hooks';
import { useFetcher } from '@/client/lib/router/fetcher';
import { resolveRepoForPanel, useRepoList, useRepoScope } from '@/client/hooks/workspace/repo-scope';
import { useRealtimeTopic } from '@/client/hooks/ui/realtime';
import { gitTopic } from '@/shared/lib/realtime/protocol';
import type { GitStatusPayload } from '@/server/lib/fs/git-status-read';

/** The status read's shape — the same payload the realtime topic carries. */
export type GitPanelStatus = GitStatusPayload;

export interface GitPanelData {
  activeRepo: string;
  setActiveRepo: (repo: string) => void;
  repos: string[];
  reposScanning: boolean;
  refreshRepos: () => void;
  /** The panel's own HTTP read is in flight. */
  isReading: boolean;
  /** `isReading` OR a topic push: the refresh affordances also light for a push. */
  isRefreshing: boolean;
  data: GitStatusPayload | undefined;
  syncCount: { ahead: number; behind: number } | undefined;
  /** Re-read the working tree, refreshing the branch's tracking ref first. */
  loadRepo: (repo?: string) => void;
  /** Ask the server for a fresh topic snapshot (a panel's own Refresh). */
  refreshTopic: () => void;
}

/**
 * The git panel's data layer: which working tree it shows, the status read, and
 * the two answers that make up one payload.
 *
 * Split out of `GitPanel` because the wiring is where the bugs live, not the
 * markup. The change list rides the REALTIME `git:` topic (the server pushes a
 * fresh read on every tool call) while the HTTP read is what refreshes the
 * branch's remote-tracking ref, so the two answer the same question from
 * different sources and the panel must not let one silently win:
 *
 *  - **The topic is the source of the LIST.** The previous `fetched ?? git.data`
 *    let the HTTP copy win unconditionally, pinning the list to whatever the
 *    mount or the last Refresh read saw and hiding every change a tool call
 *    made (measured: "No changes found." while `git status` reported the file a
 *    tool call had just created).
 *  - **The count rides the SAME payload**, so the badge cannot describe a
 *    different read than the list. The topic's count is LOCAL (no network) and
 *    therefore follows a commit a tool call makes; the HTTP read's follows a
 *    fetch. `loadRepo` reconciles them: it re-resolves the topic once its fetch
 *    settles, so the count is taken from refs that include that fetch. Pinning
 *    the badge to the HTTP copy is the reported bug — the list followed the
 *    topic while `↑ahead` stayed at its mount value.
 */
export function useGitPanelData(
  rootPath: string | undefined,
  enabled: boolean,
  refreshKey: number,
): GitPanelData {
  const fetcher = useFetcher<GitPanelStatus>();

  const { activeRepo: pickedRepo, setActiveRepo, ready: activeRepoReady } = useRepoScope(rootPath);
  const { repos, scanning: reposScanning, rescan: refreshRepos } = useRepoList(rootPath, enabled);
  // When the user has picked nothing and the workspace root is not itself a
  // repo, git falls back to the first repo discovery found — the same choice
  // the loader makes for a request that names no repo. Resolving it here rather
  // than reading it back from the response is what keeps the header label, the
  // picker's checkmark and the requests describing one repo: the response
  // arrives a render later, and by then it may belong to a workspace the user
  // has already left.
  const activeRepo = resolveRepoForPanel(pickedRepo, repos);
  const activeRepoRef = useRef(activeRepo);
  activeRepoRef.current = activeRepo;

  // `root\0repo` — the working tree the panel is showing right now.
  const scopeRef = useRef('');
  scopeRef.current = `${rootPath ?? ''}\u0000${activeRepo}`;
  // The scope the in-flight read was asked for, and the scope the payload
  // currently in `fetcher.data` was asked for. Only one read is ever in flight
  // (the fetcher aborts its predecessor), so the former is what the latter
  // becomes when a new payload arrives.
  const requestedScopeRef = useRef('');
  const payloadScopeRef = useRef('');
  const lastPayloadRef = useRef<unknown>(undefined);
  if (fetcher.data !== lastPayloadRef.current) {
    lastPayloadRef.current = fetcher.data;
    payloadScopeRef.current = requestedScopeRef.current;
  }

  const gitTopicName = enabled && activeRepoReady
    ? gitTopic(`${rootPath ?? ''}\u0000${activeRepo}`)
    : null;
  const git = useRealtimeTopic<GitStatusPayload>(gitTopicName);
  // The topic's own refresh, reached from `loadRepo`'s async tail without
  // putting `git` in an effect dependency (the hook mints a new object each
  // render, so depending on it would re-fire the scope effect every render).
  const topicRefreshRef = useRef(git.refresh);
  topicRefreshRef.current = git.refresh;

  // A switch leaves the previous repo's branch, changes and branch list in
  // `fetcher.data` until the new read lands. Rendering those under the new
  // repo's header would claim the new working tree is on the old branch with
  // the old changes, so the payload is used only while it describes the scope
  // on screen.
  const fetched = payloadScopeRef.current === scopeRef.current ? fetcher.data : undefined;
  const data = git.data ?? fetched;
  // Falls back to the HTTP read's count for the window before the topic's first
  // snapshot lands, and for a payload that carries none (a resolver that could
  // not count) — a bare `↑0 ↓0` would read as "up to date".
  const syncCount = data?.syncCount ?? fetched?.syncCount;

  const loadRepo = useCallback((repo?: string) => {
    if (!enabled) return;
    const targetRepo = repo ?? activeRepoRef.current;
    const params = new URLSearchParams();
    if (rootPath) params.set('root', rootPath);
    if (targetRepo && targetRepo !== '.') params.set('repo', targetRepo);
    // The toolbar's ↑ahead ↓behind badge is what this asks for; it makes the
    // loader refresh the branch's remote-tracking ref before counting, so the
    // numbers describe origin rather than the last fetch.
    params.set('sync', '1');
    params.set('t', String(Date.now()));
    // Tag the response with the scope it was asked for: a switch leaves the
    // previous repo's branch, changes and branch list in `fetcher.data` until
    // the new read lands, and rendering those under the new repo's header
    // claims the new working tree is on the old branch with the old changes.
    requestedScopeRef.current = scopeRef.current;
    // Re-resolve the topic once the fetch settles: the topic's count is local,
    // so a count taken before this fetch cannot see what it moved. Without the
    // re-read the badge would sit on the pre-fetch `behind` until some
    // unrelated publish happened to move it.
    const refreshTopic = topicRefreshRef.current;
    void fetcher.load(`/api/fs/git?${params.toString()}`).then(() => refreshTopic());
  }, [enabled, rootPath, fetcher.load]);

  // `activeRepo` is a dependency, not just the root: the repo list that
  // resolves the root-level fallback arrives after the first render, and a
  // workspace switch re-resolves it to '.'.
  useEffect(() => {
    if (!activeRepoReady) return;
    loadRepo();
  }, [refreshKey, rootPath, enabled, activeRepoReady, activeRepo, loadRepo]);

  // The panel's own read (mount, Refresh, post-mutation reload) — the topic's
  // push is NOT part of this, or a background tool call would disable the
  // commit box for a beat.
  const isReading = fetcher.state === 'loading';
  // The refresh affordances also light for a topic push: a tool call
  // republishes `git:` and the panel should show that it moved on its own.
  const isRefreshing = isReading || git.refreshing;

  return {
    activeRepo,
    setActiveRepo,
    repos,
    reposScanning,
    refreshRepos,
    isReading,
    isRefreshing,
    data,
    syncCount,
    loadRepo,
    refreshTopic: git.refresh,
  };
}
