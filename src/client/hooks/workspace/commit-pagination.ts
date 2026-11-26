import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import type { CommitHistoryPage, GitCommit } from '@kabmo-labs/kabmo-app-contracts/git';
import { COMMIT_PAGE_SIZE } from '@/shared/lib/fs/commit-page';
import { normalizeCommits } from '@/shared/lib/fs/commit-row';

interface UseCommitPaginationOptions {
  output: CommitHistoryPage | null;
  isGraphMode: boolean;
  rootPath?: string;
  activeRepo?: string;
}

/**
 * Pages of commit history for the commit modal.
 *
 * `total` is the branch's real commit count and arrives with the FIRST page,
 * so the header can say "50 of 646" before any `load more`. It used to be
 * dropped by the panel and only recovered from a `load more` response, which is
 * why the header read "50 commits" for a 646-commit branch.
 */
export function useCommitPagination({
  output,
  isGraphMode,
  rootPath,
  activeRepo,
}: UseCommitPaginationOptions) {
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState<boolean>(output?.hasMore ?? (output?.data?.length === COMMIT_PAGE_SIZE));
  const [totalCount, setTotalCount] = useState<number | undefined>(output?.total);

  const initialCommits: GitCommit[] = useMemo(() => normalizeCommits(output?.data), [output?.data]);
  // The raw page length, which is the count git was asked for — a row dropped
  // by normalization must not shrink it, or the next `skip` would overlap.
  const initialRawCount = Array.isArray(output?.data) ? output.data.length : 0;

  const [commits, setCommits] = useState<GitCommit[]>(initialCommits);
  // How many rows git has handed over, which is what `skip` must advance by —
  // NOT `commits.length`. The two differ whenever a row is dropped (a hash-less
  // row, or a duplicate), and advancing by the rendered length re-requests
  // rows already seen: the page overlaps, the list stops growing, and the
  // sentinel keeps asking for the same offset forever.
  const [fetchedCount, setFetchedCount] = useState(initialRawCount);

  useEffect(() => {
    setCommits(initialCommits);
    setFetchedCount(initialRawCount);
    setHasMore(output?.hasMore ?? (initialRawCount === COMMIT_PAGE_SIZE));
    // `total` is only meaningful when the response carried it; a refresh that
    // omits it must not erase the count the previous page established.
    if (typeof output?.total === 'number') setTotalCount(output.total);
  }, [initialCommits, initialRawCount, output?.hasMore, output?.total]);

  // Load more commits (lazy loading)
  const handleLoadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore) return;
    setIsLoadingMore(true);
    try {
      const formData = new FormData();
      formData.set('actionType', isGraphMode ? 'graph' : 'history');
      formData.set('limit', String(COMMIT_PAGE_SIZE));
      formData.set('skip', String(fetchedCount));
      if (rootPath) formData.set('root', rootPath);
      if (activeRepo) formData.set('repo', activeRepo);

      const res = await fetch('/api/fs/git', { method: 'POST', body: formData });
      const json = await res.json();

      if (json.success && Array.isArray(json.data)) {
        const nextBatch = normalizeCommits(json.data);
        const rawCount = json.data.length;

        setCommits((prev) => {
          const existing = new Set(prev.map((c) => c.hash));
          const fresh = nextBatch.filter((c) => !existing.has(c.hash));
          return [...prev, ...fresh];
        });
        // Advanced by the rows git RETURNED, not by the rows kept: a dropped
        // row still occupied a position in git's ordering, so counting only
        // the kept ones would re-request it on the next page.
        setFetchedCount((prev) => prev + rawCount);

        setHasMore(Boolean(json.hasMore ?? (rawCount === COMMIT_PAGE_SIZE)));
        if (typeof json.total === 'number') setTotalCount(json.total);
      } else {
        setHasMore(false);
      }
    } catch (err) {
      console.error('Failed to load more commits:', err);
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore, hasMore, isGraphMode, fetchedCount, rootPath, activeRepo]);

  return {
    commits,
    hasMore,
    totalCount,
    isLoadingMore,
    handleLoadMore,
  };
}
