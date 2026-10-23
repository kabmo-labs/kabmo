/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The Files panel's header: the repo picker, Refresh and the filter field.
 *
 * Split out of the panel because it is a self-contained strip of markup with no
 * state of its own — the panel's `index.tsx` sits at the repository's line
 * ceiling, and the tree below it is what the file is for.
 */

import { RefreshCw, Search } from 'lucide-preact';
import { GitRepoPicker } from '@/client/components/workspace/repo-picker';

export interface FileExplorerToolbarProps {
  rootPath?: string;
  activeRepo: string;
  repos: string[];
  reposScanning: boolean;
  onRefreshRepos: () => void;
  onSelectRepo: (repo: string) => void;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onRefresh: () => void;
  /** True while a read is in flight or a topic push just landed. */
  refreshing: boolean;
}

export function FileExplorerToolbar({
  rootPath,
  activeRepo,
  repos,
  reposScanning,
  onRefreshRepos,
  onSelectRepo,
  searchQuery,
  onSearchChange,
  onRefresh,
  refreshing,
}: FileExplorerToolbarProps) {
  return (
    <div className="p-3 border-b border-ink/10 flex flex-col space-y-2">
      <div className="flex items-center justify-between">
        <GitRepoPicker
          rootPath={rootPath}
          activeRepo={activeRepo}
          onSelectRepo={onSelectRepo}
          repos={repos}
          scanning={reposScanning}
          onRefreshRepos={onRefreshRepos}
        />
        <button
          onClick={onRefresh}
          className="p-1.5 text-ink/40 hover:text-ink hover:bg-ink/5 rounded transition-colors"
          title="Refresh"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </div>
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink/40" />
        <input
          type="text"
          placeholder="Search files..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.currentTarget.value)}
          className="w-full bg-canvas border border-ink/20 rounded pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:border-ink transition-colors text-ink placeholder-ink/40"
        />
      </div>
    </div>
  );
}
