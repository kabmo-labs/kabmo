import type { RefObject } from 'preact/compat';
import { Check, ChevronDown, CloudDownload, FolderTree, GitBranch, GitMerge, History, List, MoreHorizontal, Plus, RefreshCw, Settings2 } from 'lucide-preact';

interface GitBranchToolbarProps {
  branchRef: RefObject<HTMLDivElement>;
  showBranchMenu: boolean;
  setShowBranchMenu: (show: boolean) => void;
  branch: string;
  branches: string[];
  remoteBranches: string[];
  onCheckout: (branch: string) => void;
  /** Merge the named branch into the current one. */
  onMerge: (branch: string) => void;
  onOpenBranchPrompt: () => void;
  /** Open the branch management modal. */
  onManageBranches: () => void;
  optionsRef: RefObject<HTMLDivElement>;
  showOptions: boolean;
  setShowOptions: (show: boolean) => void;
  onHistory: () => void;
  onGraph: () => void;
  viewMode: 'flat' | 'tree';
  setViewMode: (mode: 'flat' | 'tree') => void;
  isBusy?: boolean;
  syncCount?: { ahead: number; behind: number };
  onSync: () => void;
  /** Refresh the remote-tracking refs without moving the branch. */
  onFetch: () => void;
  /** HEAD names no branch — the button shows the sha instead of a name. */
  detached?: boolean;
}

export function GitBranchToolbar({
  branchRef,
  showBranchMenu,
  setShowBranchMenu,
  branch,
  branches,
  remoteBranches,
  onCheckout,
  onMerge,
  onOpenBranchPrompt,
  onManageBranches,
  optionsRef,
  showOptions,
  setShowOptions,
  onHistory,
  onGraph,
  viewMode,
  setViewMode,
  isBusy = false,
  syncCount = { ahead: 0, behind: 0 },
  onSync,
  onFetch,
  detached = false,
}: GitBranchToolbarProps) {
  return (
    <div className="p-3 border-b border-ink/10 bg-canvas/50 flex items-center justify-between">
      <div className="relative" ref={branchRef}>
        <button 
          onClick={() => setShowBranchMenu(!showBranchMenu)}
          className="flex items-center space-x-1.5 hover:bg-ink/5 px-2 py-1 -ml-2 rounded transition-colors text-[11px] text-ink/80 font-medium"
          title={detached ? `Detached HEAD at ${branch}` : `On branch ${branch}`}
        >
          <GitBranch size={12} className={detached ? 'text-warning' : 'text-ink/60'} />
          <span className={`truncate max-w-[140px] ${detached ? 'font-mono text-warning' : ''}`}>{branch}</span>
          <ChevronDown size={12} className="text-ink/40" />
        </button>
        
        {showBranchMenu && (
          <div className="absolute top-full left-0 mt-1 w-56 bg-paper border border-ink/20 rounded-md shadow-lg z-50 flex flex-col overflow-hidden text-xs">
            <div className="max-h-48 scrollbar-overlay-container scrollbar-overlay-static py-1">
              {branches.length > 0 && (
                <>
                  <div className="px-3 py-1 text-[9px] uppercase tracking-wider text-ink/40 font-semibold">Local</div>
                  {branches.map(b => (
                    <div key={b} className="flex items-center group/branch">
                      <button 
                        onClick={() => { 
                          onCheckout(b);
                          setShowBranchMenu(false); 
                        }}
                        className="flex-1 min-w-0 text-left px-3 py-2 hover:bg-ink/5 flex items-center justify-between transition-colors"
                      >
                        <span className="truncate">{b}</span>
                        {branch === b && <Check size={12} className="text-ink flex-shrink-0" />}
                      </button>
                      {/* Merging is offered on the branch you are NOT on:
                          merging the current branch into itself is a no-op
                          git refuses with "Already up to date." */}
                      {branch !== b && (
                        <button
                          type="button"
                          onClick={() => { onMerge(b); setShowBranchMenu(false); }}
                          title={`Merge ${b} into ${branch}`}
                          aria-label={`Merge ${b} into ${branch}`}
                          className="touch-visible opacity-0 group-hover/branch:opacity-100 px-2 py-2 text-ink/40 hover:text-ink hover:bg-ink/5 transition-colors cursor-pointer flex-shrink-0"
                        >
                          <GitMerge size={12} />
                        </button>
                      )}
                    </div>
                  ))}
                </>
              )}
              {remoteBranches.length > 0 && (
                <>
                  <div className="px-3 py-1 text-[9px] uppercase tracking-wider text-ink/40 font-semibold">Remote</div>
                  {remoteBranches.map(b => (
                    <div key={b} className="flex items-center group/branch">
                      <button 
                        onClick={() => { 
                          onCheckout(b);
                          setShowBranchMenu(false); 
                        }}
                        className="flex-1 min-w-0 text-left px-3 py-2 hover:bg-ink/5 flex items-center justify-between transition-colors"
                      >
                        <span className="truncate">{b}</span>
                        {branch === b && <Check size={12} className="text-ink flex-shrink-0" />}
                      </button>
                      {/* A remote-tracking ref is mergeable too — `git merge
                          origin/x` is a normal thing to want. */}
                      {branch !== b && (
                        <button
                          type="button"
                          onClick={() => { onMerge(b); setShowBranchMenu(false); }}
                          title={`Merge ${b} into ${branch}`}
                          aria-label={`Merge ${b} into ${branch}`}
                          className="touch-visible opacity-0 group-hover/branch:opacity-100 px-2 py-2 text-ink/40 hover:text-ink hover:bg-ink/5 transition-colors cursor-pointer flex-shrink-0"
                        >
                          <GitMerge size={12} />
                        </button>
                      )}
                    </div>
                  ))}
                </>
              )}
              <div className="w-full h-px bg-ink/10 my-1" />
              <button 
                onClick={() => { 
                  onOpenBranchPrompt();
                  setShowBranchMenu(false); 
                }}
                className="w-full text-left px-3 py-2 hover:bg-ink/5 flex items-center space-x-2 transition-colors text-ink/80 italic"
              >
                <Plus size={12} />
                <span>Create new branch...</span>
              </button>
              <button 
                onClick={onManageBranches}
                className="w-full text-left px-3 py-2 hover:bg-ink/5 flex items-center space-x-2 transition-colors text-ink/80"
              >
                <Settings2 size={12} />
                <span>Manage branches...</span>
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center space-x-2 text-ink/40 relative" ref={optionsRef}>
        <button
          type="button"
          onClick={onFetch}
          disabled={isBusy}
          title="Fetch from all remotes and prune deleted branches"
          aria-label="Fetch"
          className="p-1 rounded hover:text-ink hover:bg-ink/5 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <CloudDownload size={13} />
        </button>

        <button
          type="button"
          onClick={onSync}
          disabled={isBusy}
          title={
            syncCount.ahead > 0 && syncCount.behind > 0
              ? `Pull ${syncCount.behind} then push ${syncCount.ahead} commit(s)`
              : syncCount.ahead > 0
                ? `Push ${syncCount.ahead} commit(s)`
                : syncCount.behind > 0
                  ? `Pull ${syncCount.behind} commit(s)`
                  : 'Up to date — sync anyway'
          }
          className="flex items-center gap-1 p-1 rounded hover:text-ink hover:bg-ink/5 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <RefreshCw size={13} />
          <span className="font-mono tabular-nums text-[10px]">↑{syncCount.ahead} ↓{syncCount.behind}</span>
        </button>

        <button
          type="button"
          onClick={onHistory} 
          title="Commit History"
          aria-label="Commit History"
          className="p-1 rounded hover:text-ink hover:bg-ink/5 cursor-pointer transition-colors"
        >
          <History size={13} />
        </button>

        <button
          type="button"
          onClick={onGraph} 
          title="Git Graph"
          aria-label="Git Graph"
          className="p-1 rounded hover:text-ink hover:bg-ink/5 cursor-pointer transition-colors"
        >
          <GitMerge size={13} />
        </button>

        <button
          type="button"
          onClick={() => setShowOptions(!showOptions)} 
          title="View Options"
          aria-label="View Options"
          aria-expanded={showOptions}
          className="p-1 rounded hover:text-ink hover:bg-ink/5 cursor-pointer transition-colors"
        >
          <MoreHorizontal size={13} />
        </button>
        
        {showOptions && (
          <div className="absolute right-0 top-full mt-1 w-36 bg-paper border border-ink/15 rounded-md shadow-lg z-50 py-1 font-mono text-xs">
            <button 
              type="button"
              onClick={() => { setViewMode('flat'); setShowOptions(false); }}
              className="w-full px-3 py-1.5 text-left text-ink hover:bg-ink/5 flex items-center justify-between transition-colors"
            >
              <div className="flex items-center space-x-1.5">
                <List size={12} className="text-ink/60" />
                <span>View as List</span>
              </div>
              {viewMode === 'flat' && <Check size={12} className="text-ink" />}
            </button>
            <button 
              type="button"
              onClick={() => { setViewMode('tree'); setShowOptions(false); }}
              className="w-full px-3 py-1.5 text-left text-ink hover:bg-ink/5 flex items-center justify-between transition-colors"
            >
              <div className="flex items-center space-x-1.5">
                <FolderTree size={12} className="text-ink/60" />
                <span>View as Tree</span>
              </div>
              {viewMode === 'tree' && <Check size={12} className="text-ink" />}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
