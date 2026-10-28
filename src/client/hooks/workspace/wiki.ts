/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Reads the wiki behind the repository the right-panel scope points at.
 *
 * Two reads, both scope-tagged:
 *
 *   - the TREE (`GET /api/wiki`) — provider, revision, and every path in the
 *     wiki, which is also what a page's own links resolve against;
 *   - one PAGE (`GET /api/wiki/page`) — markdown source for the selection.
 *
 * Tagging is not decoration here. The scope is `root\0repo`, and a repository
 * switch changes WHICH wiki is being read: a page list or a page body that lands
 * after the switch describes a wiki the panel is no longer showing, and
 * rendering it under the new repo's header would attribute one project's
 * documentation to another.
 *
 * The tree read is cheap because the server caches its mirror for a minute: the
 * `wiki:<scope>` topic re-lists a local repository rather than re-fetching the
 * remote, and only the user's own Refresh forces a fetch.
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { useRealtimeTopic } from '@/client/hooks/ui/realtime';
import { wikiTopic } from '@/shared/lib/realtime/protocol';
import type { WikiPagePayload, WikiRepoPayload } from '@/shared/types/wiki';

/** `root\0repo` — the working tree a wiki read belongs to. */
export function wikiScopeKey(rootPath: string | undefined, repo: string): string {
  return `${rootPath ?? ''}\u0000${repo}`;
}

function wikiParams(rootPath: string | undefined, repo: string): URLSearchParams {
  const params = new URLSearchParams();
  if (rootPath) params.set('root', rootPath);
  if (repo && repo !== '.') params.set('repo', repo);
  return params;
}

export interface WikiScopeArgs {
  rootPath: string | undefined;
  /** The shared repo pick, relative to `rootPath`. */
  repo: string;
  /** False when the view cannot read at all (no active workspace). */
  enabled: boolean;
  /** False while the view is hidden: releases the wiki topic. */
  active: boolean;
}

export interface WikiTreeState {
  data: WikiRepoPayload | null;
  isLoading: boolean;
  /** A beat after a topic push landed (a tool call re-lists the wiki too). */
  refreshing: boolean;
  /** Set when the last read failed; the previous payload is kept meanwhile. */
  error: string | null;
  /** `force` bypasses the server's mirror cache — the panel's own Refresh. */
  reload: (opts?: { force?: boolean }) => void;
}

export function useWikiTree(
  args: WikiScopeArgs & {
    /** Bumped by a workspace refresh, so a write anywhere re-lists the wiki. */
    revisionKey?: number;
  },
): WikiTreeState {
  const { rootPath, repo, enabled, active, revisionKey = 0 } = args;
  const scope = wikiScopeKey(rootPath, repo);
  const [error, setError] = useState<string | null>(null);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  // The wiki tree rides the `wiki:<root>\0<repo>` topic: the server re-reads
  // the mirror when a fetch settles, so the panel renders what it is handed
  // instead of asking on a timer. The topic is scoped, so a tree that arrives
  // for another repository cannot be rendered here.
  const topic = useRealtimeTopic<WikiRepoPayload>(wikiTopic(scope), { enabled: enabled && active });
  const { refresh: refreshTopic } = topic;

  // A scope switch is a different wiki: drop the previous read's error, or the
  // new repository's panel would open under the old one's message.
  useEffect(() => {
    setError(null);
  }, [scope]);

  /**
   * Re-read the tree. `force` is the panel's own Refresh: it re-fetches the
   * remote mirror over HTTP (the topic's resolver reads the cached mirror and
   * cannot express "go to the network"), then re-snapshots the topic from it.
   */
  const reload = useCallback(
    (opts?: { force?: boolean }) => {
      if (!enabled) return;
      if (!opts?.force) {
        refreshTopic();
        return;
      }
      const requested = scopeRef.current;
      const params = wikiParams(rootPath, repo);
      params.set('refresh', '1');
      fetch(`/api/wiki?${params.toString()}`)
        .then(async (response) => {
          const payload = (await response.json()) as WikiRepoPayload & { error?: string };
          if (!response.ok) throw new Error(payload?.error || `Wiki request failed (${response.status})`);
        })
        .then(() => {
          if (scopeRef.current !== requested) return;
          setError(null);
          // The mirror is fresh now; the topic's re-read picks it up, so both
          // paths converge on one payload and cannot disagree.
          refreshTopic();
        })
        .catch((err: unknown) => {
          if (scopeRef.current !== requested) return;
          setError(err instanceof Error ? err.message : 'Failed to load the wiki');
        });
    },
    [enabled, rootPath, repo, refreshTopic],
  );

  // A workspace refresh re-lists the wiki (a write anywhere may have moved it).
  useEffect(() => {
    if (revisionKey > 0) refreshTopic();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revisionKey]);

  return {
    data: topic.data,
    isLoading: topic.isLoading,
    refreshing: topic.refreshing,
    error,
    reload,
  };
}

export interface WikiPageState {
  data: WikiPagePayload | null;
  isLoading: boolean;
  error: string | null;
}

export function useWikiPage(
  args: WikiScopeArgs & {
    /** Page to read; null when the wiki has no selection yet. */
    path: string | null;
    /** Bumped after a forced tree re-fetch, so the body follows a moved ref. */
    revisionKey?: number;
  },
): WikiPageState {
  const { rootPath, repo, path, enabled, active, revisionKey = 0 } = args;
  const scope = `${wikiScopeKey(rootPath, repo)}\u0000${path ?? ''}`;
  const [state, setState] = useState<{ scope: string; data: WikiPagePayload | null }>({ scope, data: null });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    if (!enabled || !active || !path) {
      setState({ scope, data: null });
      setError(null);
      return;
    }
    const request = ++requestRef.current;
    setIsLoading(true);
    const params = wikiParams(rootPath, repo);
    params.set('path', path);
    fetch(`/api/wiki/page?${params.toString()}`)
      .then(async (response) => {
        const payload = (await response.json()) as WikiPagePayload & { error?: string };
        if (!response.ok) throw new Error(payload?.error || `Page request failed (${response.status})`);
        return payload;
      })
      .then((payload) => {
        if (requestRef.current !== request) return;
        setState({ scope, data: payload });
        setError(null);
      })
      .catch((err: unknown) => {
        if (requestRef.current !== request) return;
        setError(err instanceof Error ? err.message : 'Failed to load the page');
      })
      .finally(() => {
        if (requestRef.current === request) setIsLoading(false);
      });
  }, [scope, rootPath, repo, path, enabled, active, revisionKey]);

  return {
    data: state.scope === scope ? state.data : null,
    isLoading,
    error,
  };
}
