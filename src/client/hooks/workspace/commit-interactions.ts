import { useCallback, useState } from 'preact/hooks';
import type { GitCommit, GitCommitFile } from '@kabmo-labs/kabmo-app-contracts/git';

interface UseCommitInteractionsOptions {
  onExecuteAction?: (actionType: string, file?: string, extra?: Record<string, string>) => void;
  rootPath?: string;
  activeRepo?: string;
}

export function useCommitInteractions({
  onExecuteAction,
  rootPath,
  activeRepo,
}: UseCommitInteractionsOptions) {
  const [fileDiffs, setFileDiffs] = useState<Record<string, string>>({});
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [loadingFiles, setLoadingFiles] = useState<Set<string>>(new Set());
  /**
   * Files whose diff was re-read with the whole file around the change.
   *
   * "Expand all context" cannot be a client-side operation: git's default patch
   * carries three context lines, so there is nothing more in the payload to
   * reveal. The toggle re-asks the server for `-U<large>` instead.
   */
  const [fullContextFiles, setFullContextFiles] = useState<Set<string>>(new Set());

  const loadDiff = useCallback(
    async (commitHash: string, file: GitCommitFile, full: boolean) => {
      const diffKey = `${commitHash}:${file.file}`;
      setLoadingFiles((prev) => new Set(prev).add(diffKey));
      try {
        const formData = new FormData();
        formData.set('actionType', 'commit_diff');
        formData.set('hash', commitHash);
        formData.set('file', file.file);
        if (full) formData.set('full', '1');
        if (rootPath) formData.set('root', rootPath);
        if (activeRepo && activeRepo !== '.') formData.set('repo', activeRepo);

        const res = await fetch('/api/fs/git', { method: 'POST', body: formData });
        const json = await res.json();
        if (json && typeof json.diff === 'string') {
          setFileDiffs((prev) => ({ ...prev, [diffKey]: json.diff }));
        } else if (json && json.error) {
          setFileDiffs((prev) => ({ ...prev, [diffKey]: `// Error: ${json.error}` }));
        }
      } catch (err: unknown) {
        console.error('Failed to load file diff:', err);
        const reason = err instanceof Error ? err.message : 'Network error';
        setFileDiffs((prev) => ({ ...prev, [diffKey]: `// Error loading diff: ${reason}` }));
      } finally {
        setLoadingFiles((prev) => {
          const next = new Set(prev);
          next.delete(diffKey);
          return next;
        });
      }
    },
    [rootPath, activeRepo],
  );

  const handleToggleFile = useCallback(
    async (commitHash: string, file: GitCommitFile) => {
      const diffKey = `${commitHash}:${file.file}`;
      const willExpand = !expandedFiles.has(diffKey);

      setExpandedFiles((prev) => {
        const next = new Set(prev);
        if (next.has(diffKey)) {
          next.delete(diffKey);
        } else {
          next.add(diffKey);
        }
        return next;
      });

      if (willExpand && fileDiffs[diffKey] === undefined && !file.diff) {
        await loadDiff(commitHash, file, false);
      }
    },
    [expandedFiles, fileDiffs, loadDiff],
  );

  /** The viewer's "Expand all context" / "Collapse context" toggle. */
  const handleToggleContext = useCallback(
    async (commitHash: string, file: GitCommitFile) => {
      const diffKey = `${commitHash}:${file.file}`;
      const willExpand = !fullContextFiles.has(diffKey);
      setFullContextFiles((prev) => {
        const next = new Set(prev);
        if (next.has(diffKey)) next.delete(diffKey);
        else next.add(diffKey);
        return next;
      });
      await loadDiff(commitHash, file, willExpand);
    },
    [fullContextFiles, loadDiff],
  );

  const handleCommitAction = useCallback(
    (action: string, commit: GitCommit) => {
      if (!onExecuteAction) return;

      if (action === 'checkout') {
        // A commit row's "checkout" names a COMMIT, so the server detaches
        // rather than trying to track a branch by that name.
        onExecuteAction('checkout', undefined, { branch: commit.hash });
      } else if (action === 'create_branch_here') {
        const name = window.prompt(`Create new branch at commit ${commit.shortHash}:`, `branch-${commit.shortHash}`);
        if (name?.trim()) {
          // `create_branch_at`, not `create_branch`: this button creates a ref
          // at the row's commit and leaves the working tree alone, where the
          // toolbar's action creates and switches. Both the start point and the
          // no-switch behavior were wrong before (verified in the browser: the
          // branch landed on HEAD, then failed outright on a dirty tree).
          onExecuteAction('create_branch_at', undefined, { branch: name.trim(), hash: commit.hash });
        }
      } else if (action === 'cherry_pick') {
        if (window.confirm(`Cherry-pick commit ${commit.shortHash} onto current branch?`)) {
          onExecuteAction('cherry_pick', undefined, { hash: commit.hash });
        }
      } else if (action === 'revert') {
        if (window.confirm(`Revert commit ${commit.shortHash}?`)) {
          onExecuteAction('revert_commit', undefined, { hash: commit.hash });
        }
      } else if (action === 'reset') {
        const mode = window.prompt(`Reset current branch to ${commit.shortHash} (soft, mixed, hard):`, 'soft');
        if (mode && ['soft', 'mixed', 'hard'].includes(mode.toLowerCase())) {
          onExecuteAction('reset_commit', undefined, { hash: commit.hash, mode: mode.toLowerCase() });
        }
      } else if (action === 'merge') {
        if (window.confirm(`Merge commit ${commit.shortHash} into current branch?`)) {
          onExecuteAction('merge_commit', undefined, { hash: commit.hash });
        }
      } else if (action === 'rebase') {
        if (window.confirm(`Rebase current branch onto commit ${commit.shortHash}?`)) {
          onExecuteAction('rebase_commit', undefined, { hash: commit.hash });
        }
      }
    },
    [onExecuteAction]
  );

  return {
    fileDiffs,
    expandedFiles,
    loadingFiles,
    fullContextFiles,
    handleToggleFile,
    handleToggleContext,
    handleCommitAction,
  };
}
