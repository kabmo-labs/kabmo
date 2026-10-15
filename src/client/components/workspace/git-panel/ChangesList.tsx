import { Minus, Plus, Undo2 } from 'lucide-preact';
import type { GitChange } from '@/shared/types';
import { useSessionState } from '@/client/hooks/workspace/session-state';
import { isUnmergedCode } from '@/shared/lib/fs/git-unmerged';
import { GitFileItem } from '@/client/components/workspace/git-panel/FileItem';
import { GitConflictItem } from '@/client/components/workspace/git-panel/ConflictItem';
import { GitTreeView } from '@/client/components/workspace/git-panel/TreeView';

interface GitChangesListProps {
  changes: GitChange[];
  isLoading: boolean;
  viewMode: 'flat' | 'tree';
  repo?: string;
  rootPath?: string;
  onAction: (actionType: string, file?: string) => void;
  /** Resolve one conflicted path — see `GitConflictItem`. */
  onResolve?: (file: string, side: 'ours' | 'theirs' | '') => void;
}

export function GitChangesList({ changes, isLoading, viewMode, repo, rootPath, onAction, onResolve }: GitChangesListProps) {
  const [stagedExpanded, setStagedExpanded] = useSessionState<boolean>('git.stagedExpanded', true);
  const [unstagedExpanded, setUnstagedExpanded] = useSessionState<boolean>('git.unstagedExpanded', true);
  const [conflictsExpanded, setConflictsExpanded] = useSessionState<boolean>('git.conflictsExpanded', true);

  /**
   * A conflicted path is its OWN section, and is excluded from both of the
   * others.
   *
   * The two filters below read the porcelain columns, and an unmerged pair's
   * columns are the two SIDES of a conflict rather than an index/worktree pair:
   * `UU` has no space in either, so it satisfied BOTH filters and the same path
   * rendered twice — once under "Staged Changes" and once under "Changes",
   * neither saying it was conflicted. Measured over all seven pairs.
   */
  const conflictedChanges = changes.filter((c) => isUnmergedCode(c.status));

  const stagedChanges = changes.filter(c => {
    if (isUnmergedCode(c.status)) return false;
    const status = c.status;
    return status && status[0] !== ' ' && status[0] !== '?';
  });

  const unstagedChanges = changes.filter(c => {
    if (isUnmergedCode(c.status)) return false;
    const status = c.status;
    return (status && status[1] !== ' ' && status[1] !== '?') || status === '??';
  });

  if (isLoading && changes.length === 0) {
    return (
      <div className="flex-1 scrollbar-overlay-container font-mono text-[11px] text-ink/80">
        <div className="p-4 text-center text-ink/40 italic">Loading...</div>
      </div>
    );
  }

  if (changes.length === 0) {
    return (
      <div className="flex-1 scrollbar-overlay-container font-mono text-[11px] text-ink/80">
        <div className="p-4 text-center text-ink/40 italic">No changes found.</div>
      </div>
    );
  }

  return (
    <div className="flex-1 scrollbar-overlay-container font-mono text-[11px] text-ink/80">
      <div className="py-1">
        {/* Conflicts first: while one exists it is the only thing the reader
            has to act on, and it is the section that makes the operation bar's
            count above drive to zero. */}
        {conflictedChanges.length > 0 && (
          <div className="mb-2">
            <div
              className="flex items-center justify-between px-3 py-1 group hover:bg-warning/5 cursor-pointer transition-colors"
              onClick={() => setConflictsExpanded(!conflictsExpanded)}
            >
              <div className="flex items-center space-x-1 font-semibold text-warning text-xs">
                <span className="w-3 text-center">{conflictsExpanded ? '▾' : '▸'}</span>
                <span>Conflicts</span>
                <span className="text-warning/70 font-normal ml-1 border border-warning/30 rounded-full px-1.5 text-[9px] bg-paper">
                  {conflictedChanges.length}
                </span>
              </div>
            </div>

            {conflictsExpanded && conflictedChanges.map((c) => (
              <GitConflictItem
                key={`conflict-${c.file}`}
                change={c}
                repo={repo}
                rootPath={rootPath}
                onResolve={onResolve ?? (() => {})}
              />
            ))}
          </div>
        )}

        {stagedChanges.length > 0 && (
          <div className="mb-2">
            <div
              className="flex items-center justify-between px-3 py-1 group hover:bg-ink/5 cursor-pointer transition-colors"
              onClick={() => setStagedExpanded(!stagedExpanded)}
            >
              <div className="flex items-center space-x-1 font-semibold text-ink text-xs">
                <span className="w-3 text-center">{stagedExpanded ? '▾' : '▸'}</span>
                <span>Staged Changes</span>
                <span className="text-ink/40 font-normal ml-1 border border-ink/20 rounded-full px-1.5 text-[9px] bg-paper">
                  {stagedChanges.length}
                </span>
              </div>
              <div className="touch-visible opacity-0 group-hover:opacity-100 flex items-center space-x-1 text-ink/40 flex-shrink-0">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAction('unstage_all');
                  }}
                  title="Unstage All Changes"
                  className="w-5 h-5 flex items-center justify-center rounded hover:text-ink hover:bg-ink/10 cursor-pointer transition-colors"
                >
                  <Minus size={12} />
                </button>
              </div>
            </div>

            {stagedExpanded && (
              viewMode === 'tree' ? (
                <GitTreeView
                  changes={stagedChanges}
                  isStaged={true}
                  repo={repo}
                  rootPath={rootPath}
                  onAction={onAction}
                />
              ) : (
                stagedChanges.map(c => (
                  <GitFileItem
                    key={c.file + 'staged'}
                    change={c}
                    isStaged={true}
                    repo={repo}
                    rootPath={rootPath}
                    onAction={onAction}
                  />
                ))
              )
            )}
          </div>
        )}

        {unstagedChanges.length > 0 && (
          <div>
            <div
              className="flex items-center justify-between px-3 py-1 group hover:bg-ink/5 cursor-pointer transition-colors"
              onClick={() => setUnstagedExpanded(!unstagedExpanded)}
            >
              <div className="flex items-center space-x-1 font-semibold text-ink text-xs">
                <span className="w-3 text-center">{unstagedExpanded ? '▾' : '▸'}</span>
                <span>Changes</span>
                <span className="text-ink/40 font-normal ml-1 border border-ink/20 rounded-full px-1.5 text-[9px] bg-paper">
                  {unstagedChanges.length}
                </span>
              </div>
              <div className="touch-visible opacity-0 group-hover:opacity-100 flex items-center space-x-1 text-ink/40 flex-shrink-0">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAction('revert_all');
                  }}
                  title="Discard All Changes"
                  className="w-5 h-5 flex items-center justify-center rounded hover:text-error hover:bg-error/10 cursor-pointer transition-colors"
                >
                  <Undo2 size={12} />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAction('stage_all');
                  }}
                  title="Stage All Changes"
                  className="w-5 h-5 flex items-center justify-center rounded hover:text-ink hover:bg-ink/10 cursor-pointer transition-colors"
                >
                  <Plus size={12} />
                </button>
              </div>
            </div>

            {unstagedExpanded && (
              viewMode === 'tree' ? (
                <GitTreeView
                  changes={unstagedChanges}
                  isStaged={false}
                  repo={repo}
                  rootPath={rootPath}
                  onAction={onAction}
                />
              ) : (
                unstagedChanges.map(c => (
                  <GitFileItem
                    key={c.file + 'unstaged'}
                    change={c}
                    isStaged={false}
                    repo={repo}
                    rootPath={rootPath}
                    onAction={onAction}
                  />
                ))
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}
