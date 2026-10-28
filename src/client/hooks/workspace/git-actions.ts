import { useCallback, useRef } from 'preact/hooks';
import { useFetcher, type FetcherState } from '@/client/lib/router/fetcher';

interface ActionPayload {
  success: boolean;
  type?: string;
  data?: unknown[];
  hasMore?: boolean;
  total?: number;
  error?: string;
  /**
   * The operation the action left stopped on a conflict (`merge`, `rebase`,
   * `stash-pop`, …), reported by the verbs that can leave one.
   *
   * A stopped operation is a SUCCESS with a different outcome — the pull ran
   * but the push did not, the merge started but nothing is merged — so the
   * toast cannot be built from `success` alone.
   */
  stopped?: string | null;
}

/** The action a response answers, kept so the toast can name what it acted on. */
export interface GitDispatchedAction {
  actionType: string;
  extra?: Record<string, string>;
}

export interface GitActionFetcher {
  /** The action fetcher's own in-flight state — a user-started action. */
  state: FetcherState;
  /** Submit one action. `file` and `extra` become form fields. */
  execute: (actionType: string, file?: string, extra?: Record<string, string>) => void;
  /** The last response, consumed exactly once by the caller's effect. */
  data: ActionPayload | undefined;
  /**
   * The fields of the action `data` answers.
   *
   * Recorded HERE rather than at each call site: the panel reaches `execute`
   * from a dozen handlers (the toolbar, the change rows, the modals, the commit
   * box), and a toast that reads the dispatch's own operands — the branch, the
   * commit subject, the stash ref — needs them without threading a second
   * argument through every one of them.
   */
  lastAction: GitDispatchedAction | null;
}

/**
 * The git panel's mutation channel.
 *
 * Split out of `GitPanel` because that module is at the repo's line ceiling,
 * and because the request SHAPE is the part with the rules in it: every action
 * carries the scope it acts on (`root` and `repo`), which is what keeps a
 * request from landing on the workspace root while the panel shows a nested
 * repository.
 *
 * `consumeData` exists because `useFetcher`'s payload is STICKY: it holds the
 * last response for the life of the mount. `GitPanel` acts on each response
 * once (opens the history modal, reloads, or reports the error), and without a
 * consumed-marker any later run of that effect — a new `loadRepo` identity, a
 * re-render — would re-open a modal the user had already closed.
 */
export function useGitActions(rootPath: string | undefined, activeRepo: string): GitActionFetcher {
  const fetcher = useFetcher<ActionPayload>();
  const lastActionRef = useRef<GitDispatchedAction | null>(null);

  const execute = useCallback(
    (actionType: string, file?: string, extra?: Record<string, string>) => {
      lastActionRef.current = { actionType, extra };
      const formData = new FormData();
      formData.append('actionType', actionType);
      formData.append('repo', activeRepo);
      if (rootPath) formData.append('root', rootPath);
      if (file) formData.append('file', file);
      if (extra) {
        Object.entries(extra).forEach(([key, val]) => formData.append(key, val));
      }
      fetcher.submit(formData, { method: 'POST', action: '/api/fs/git' });
    },
    [activeRepo, rootPath, fetcher],
  );

  return { state: fetcher.state, execute, data: fetcher.data, lastAction: lastActionRef.current };
}
