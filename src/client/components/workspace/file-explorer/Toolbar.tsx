/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Files panel's header: the repo picker, Refresh and the filter field.
 *
 * Split out of the panel because it is a self-contained strip of markup with no
 * state of its own — the panel's `index.tsx` sits at the repository's line
 * ceiling, and the tree below it is what the file is for.
 *
 * The picker row is the shared `PanelHeader`, so its height and the rail's
 * first mark are one fact. The filter field is a second row inside the same
 * bordered block: it belongs to this view, not to the header every repo-scoped
 * view shares.
 */

import { Search } from 'lucide-preact';
import { GitRepoPicker } from '@/client/components/workspace/repo-picker';
import { PanelHeader } from '@/client/components/workspace/panel-header';
import { RefreshButton } from '@/client/components/common/header-button';

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
    <div className="border-b border-ink/10">
      <PanelHeader
        className="border-b-0"
        left={
          <GitRepoPicker
            rootPath={rootPath}
            activeRepo={activeRepo}
            onSelectRepo={onSelectRepo}
            repos={repos}
            scanning={reposScanning}
            onRefreshRepos={onRefreshRepos}
          />
        }
        right={
          <RefreshButton
            label="Refresh"
            onClick={onRefresh}
            busy={refreshing}
          />
        }
      />
      <div className="px-3 pb-3">
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
    </div>
  );
}
