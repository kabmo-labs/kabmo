import { FolderGit2, RotateCcw } from 'lucide-preact';
import { GitRepoPicker } from '@/client/components/workspace/repo-picker';

interface GitRepoHeaderProps {
  activeRepo: string;
  repos: string[];
  /** Spins the refresh icon: an in-flight HTTP read OR a topic push. */
  isRefreshing: boolean;
  rootPath?: string;
  reposScanning: boolean;
  onSelectRepo: (repo: string) => void;
  onRefresh: () => void;
  onRefreshRepos: () => void;
}

/**
 * The Source Control panel's header: the repo picker and the panel's own
 * Refresh.
 *
 * **The picker is the SHARED one, not a second dropdown.** This header used to
 * carry its own copy — its own trigger, its own filter, its own per-session
 * query slot, and a list of `<button>`s identical to the one the other four
 * panels render. Two implementations of one control is how the git panel came
 * to be the only surface without a way to manage a long repo list, and how a
 * label or a filter fix could land in one of them and not the other.
 *
 * The `GIT •` prefix the trigger used to draw is gone with it: the panel's own
 * title is directly above, so the word named the panel rather than the
 * repository, and the picker's label is the repository's name.
 */
export function GitRepoHeader({
  activeRepo,
  repos,
  isRefreshing,
  rootPath,
  reposScanning,
  onSelectRepo,
  onRefresh,
  onRefreshRepos,
}: GitRepoHeaderProps) {
  return (
    <div className="p-3 border-b border-ink/10 flex items-center justify-between">
      <div className="flex items-center gap-1.5 min-w-0">
        <FolderGit2 size={12} className="text-ink/50 flex-shrink-0" aria-hidden />
        <GitRepoPicker
          rootPath={rootPath}
          activeRepo={activeRepo}
          onSelectRepo={onSelectRepo}
          repos={repos}
          scanning={reposScanning}
          onRefreshRepos={onRefreshRepos}
        />
      </div>

      <div className="flex space-x-2 text-ink/40">
        <button
          type="button"
          onClick={onRefresh}
          title="Refresh"
          aria-label="Refresh"
          className="hover:text-ink cursor-pointer inline-flex"
        >
          <RotateCcw size={14} className={isRefreshing ? 'animate-spin' : ''} />
        </button>
      </div>
    </div>
  );
}
