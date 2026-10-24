/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The diff panel's git writes, and the conflict-marker read behind its banner.
 *
 * Split out of the panel because these are the only parts of it that talk to
 * the server: the panel used to fire and forget (`fetcher.submit` + an
 * optimistic flip + a 300ms timer), which made a rejected action
 * indistinguishable from a successful one — the badge flipped and the diff
 * silently stayed put. Every write here AWAITS its answer and reports the
 * server's own reason.
 *
 * `revert` is the server's name for "restore this file from the index", and it
 * is the one that handles the untracked case (there the file is removed).
 * Sending `discard`, which no handler matched, returned `{success: true}` for
 * doing nothing at all.
 */

import { useCallback, useEffect, useState } from 'preact/hooks';
import type { ConflictMarkers } from '@/shared/lib/fs/git-unmerged';

export interface DiffGitActions {
  /** A write is in flight; the toolbar locks its actions. */
  isBusy: boolean;
  /** The server's refusal, or a transport failure, as a sentence. */
  error: string | null;
  /** The conflict sides' labels from the file's own markers (`{}` when none). */
  markers: ConflictMarkers;
  dismissError: () => void;
  /** Stage or unstage this path, then re-read the diff at the new side. */
  stageUnstage: () => Promise<void>;
  /** Take one side of a conflict (or only stage a resolved file with `''`). */
  resolve: (side: 'ours' | 'theirs' | '') => Promise<void>;
  /** Restore this file from the index — the untracked case removes it. */
  revert: () => Promise<void>;
}

export interface DiffGitActionsArgs {
  filePath: string;
  repo: string;
  root?: string;
  /** The status the panel currently believes (`UU`, `M`, …). */
  status: string;
  staged: boolean;
  /** The panel is showing a conflicted file, so its marker labels are read. */
  conflicted: boolean;
  /** Adopt a state change the server confirmed. */
  adoptState: (patch: { staged: boolean }) => void;
  /** Re-read the diff, optionally at the other side of the index. */
  fetchDiff: (options?: { staged: boolean }) => Promise<void>;
  /** Something on disk changed, so the workspace panels should refresh. */
  onFileSaved?: () => void;
}

export function useDiffGitActions(args: DiffGitActionsArgs): DiffGitActions {
  const { filePath, repo, root, staged, conflicted, adoptState, fetchDiff, onFileSaved } = args;
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [markers, setMarkers] = useState<ConflictMarkers>({});

  const run = useCallback(
    async (fields: Record<string, string>): Promise<boolean> => {
      const fd = new FormData();
      for (const [key, value] of Object.entries(fields)) fd.set(key, value);
      fd.set('repo', repo || '.');
      if (root) fd.set('root', root);
      try {
        const res = await fetch('/api/fs/git', { method: 'POST', body: fd });
        const data = (await res.json().catch(() => null)) as { success?: boolean; error?: string } | null;
        if (!res.ok || !data?.success) {
          setError(data?.error || `Request failed (HTTP ${res.status})`);
          return false;
        }
        setError(null);
        return true;
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Request failed');
        return false;
      }
    },
    [repo, root],
  );

  /** One write, its busy flag, and the refresh every action ends with. */
  const write = useCallback(
    async (fields: Record<string, string>, after: () => Promise<void>): Promise<void> => {
      setIsBusy(true);
      try {
        if (!(await run(fields))) return;
        await after();
      } finally {
        setIsBusy(false);
      }
    },
    [run],
  );

  // The marker labels are fetched when the file turns out to be conflicted, and
  // re-fetched when the path changes. Keyed on the path and the status so a
  // resolve (which changes the status away from `UU`) clears the banner.
  useEffect(() => {
    if (!conflicted) {
      setMarkers({});
      return;
    }
    let cancelled = false;
    const params = new URLSearchParams({ conflictMarkers: '1', file: filePath, repo: repo || '.' });
    if (root) params.set('root', root);
    void fetch(`/api/fs/git?${params.toString()}`)
      .then((res) => res.json() as Promise<{ markers?: ConflictMarkers }>)
      .then((body) => {
        if (!cancelled) setMarkers(body.markers ?? {});
      })
      .catch(() => {
        if (!cancelled) setMarkers({});
      });
    return () => {
      cancelled = true;
    };
  }, [conflicted, filePath, repo, root]);

  return {
    isBusy,
    error,
    markers,
    dismissError: () => setError(null),
    stageUnstage: () =>
      write({ actionType: staged ? 'unstage' : 'stage', file: filePath }, async () => {
        adoptState({ staged: !staged });
        onFileSaved?.();
        await fetchDiff({ staged: !staged });
      }),
    resolve: (side) =>
      write({ actionType: 'resolve_conflict', file: filePath, ...(side ? { side } : {}) }, async () => {
        onFileSaved?.();
        await fetchDiff();
      }),
    revert: () =>
      write({ actionType: 'revert', file: filePath }, async () => {
        onFileSaved?.();
        await fetchDiff();
      }),
  };
}
