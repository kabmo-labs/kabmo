import type { RefObject } from 'preact/compat';
import { Check, ChevronDown, FolderGit2, RotateCcw, Search } from 'lucide-preact';
import { useSessionState } from '@/client/hooks/workspace/session-state';

interface GitRepoHeaderProps {
  repoRef: RefObject<HTMLDivElement>;
  showRepoMenu: boolean;
  setShowRepoMenu: (show: boolean) => void;
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

function workspaceFolderName(rootPath?: string): string {
  if (!rootPath) return 'workspace root';
  const parts = rootPath.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : 'workspace root';
}

export function GitRepoHeader({
  repoRef,
  showRepoMenu,
  setShowRepoMenu,
  activeRepo,
  repos,
  isRefreshing,
  rootPath,
  reposScanning,
  onSelectRepo,
  onRefresh,
  onRefreshRepos,
}: GitRepoHeaderProps) {
  const [repoQuery, setRepoQuery] = useSessionState<string>('git.repoQuery', '');
  const rootLabel = workspaceFolderName(rootPath);

  const filterLabel = (r: string) => (r === '.' ? rootLabel : r);

  const filteredRepos = repos.filter(r => {
    if (!repoQuery.trim()) return true;
    return filterLabel(r).toLowerCase().includes(repoQuery.toLowerCase());
  });

  return (
    <div className="p-3 border-b border-ink/10 flex items-center justify-between">
      <div className="relative" ref={repoRef}>
        <button 
          onClick={() => setShowRepoMenu(!showRepoMenu)}
          className="flex items-center space-x-1.5 hover:bg-ink/5 px-2 py-1 -ml-2 rounded transition-colors text-xs text-ink/80 font-medium"
        >
          <FolderGit2 size={12} className="text-ink/60" />
          <span className="flex items-center space-x-1 truncate max-w-[150px]">
            <span className="text-ink/50 font-normal uppercase tracking-wider text-[10px]">GIT</span>
            <span className="text-ink/30">•</span>
            <span>{activeRepo === '.' ? rootLabel : activeRepo.split('/').pop()}</span>
          </span>
          <ChevronDown size={12} className="text-ink/40" />
        </button>
        
        {showRepoMenu && (
          <div className="absolute top-full left-0 mt-1 w-52 bg-paper border border-ink/20 rounded-md shadow-lg z-50 flex flex-col overflow-hidden text-xs">
            <div className="px-2 py-1.5 border-b border-ink/10 flex items-center space-x-1.5">
              <Search size={11} className="text-ink/40 flex-shrink-0" />
              <input
                type="text"
                value={repoQuery}
                onChange={(e) => setRepoQuery(e.currentTarget.value)}
                placeholder="Search repos..."
                title="Search repositories"
                className="w-full bg-transparent outline-none text-xs text-ink placeholder-ink/40"
                autoFocus
              />
              {repoQuery && (
                <button
                  type="button"
                  onClick={() => setRepoQuery('')}
                  title="Clear search"
                  className="text-ink/40 hover:text-ink flex-shrink-0"
                >
                  ×
                </button>
              )}
              <button
                type="button"
                onClick={onRefreshRepos}
                title="Refresh nested repos"
                disabled={reposScanning}
                className="text-ink/40 hover:text-ink flex-shrink-0 transition-colors disabled:opacity-40 disabled:hover:text-ink/40"
              >
                <RotateCcw size={11} className={reposScanning ? 'animate-spin' : ''} />
              </button>
            </div>
            <div className="max-h-48 scrollbar-overlay-container py-1">
              {filteredRepos.length === 0 ? (
                <div className="px-3 py-2 text-ink/40 italic">No repos found</div>
              ) : (
                filteredRepos.map(r => (
                  <button 
                    key={r}
                    onClick={() => { 
                      onSelectRepo(r);
                      setShowRepoMenu(false); 
                      setRepoQuery('');
                    }}
                    title={filterLabel(r)}
                    className="w-full text-left px-3 py-2 hover:bg-ink/5 flex items-center justify-between transition-colors"
                  >
                    <span className="truncate">{filterLabel(r)}</span>
                    {activeRepo === r && <Check size={12} className="text-ink" />}
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex space-x-2 text-ink/40">
        <button
          type="button"
          onClick={onRefresh} 
          title="Refresh"
          className="hover:text-ink cursor-pointer inline-flex"
        >
          <RotateCcw 
            size={14} 
            className={isRefreshing ? 'animate-spin' : ''} 
          />
        </button>
      </div>
    </div>
  );
}
