import { FolderGit2 } from 'lucide-preact';
import { GitRepoPicker } from '@/client/components/workspace/repo-picker';
import { PanelHeader } from '@/client/components/workspace/panel-header';
import { RefreshButton } from '@/client/components/common/header-button';

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
 *
 * The strip itself is the shared `PanelHeader`, so this view's picker sits on
 * the same line as the rail's first mark and every other repo-scoped view.
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
    <PanelHeader
      left={
        <>
          <FolderGit2 size={12} className="text-ink/50 flex-shrink-0" aria-hidden />
          <GitRepoPicker
            rootPath={rootPath}
            activeRepo={activeRepo}
            onSelectRepo={onSelectRepo}
            repos={repos}
            scanning={reposScanning}
            onRefreshRepos={onRefreshRepos}
          />
        </>
      }
      right={
        <RefreshButton
          label="Refresh"
          onClick={onRefresh}
          busy={isRefreshing}
        />
      }
    />
  );
}
