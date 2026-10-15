/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The repo picker every right-panel view shares: a compact dropdown for the
 * common case (two or three repositories) plus the modal that opens from its
 * footer for the case it cannot serve (dozens, with state to compare).
 *
 * **One component, four panels.** Files, Search, Git, Terminal and Wiki all
 * describe the same working tree through the same shared selection
 * (`workspace.activeRepo`), so a per-panel copy of the picker is a second place
 * for the label, the filter and the "manage" affordance to drift. It lives
 * beside those panels rather than inside `file-explorer/`, which is where it
 * started and which was never where it belonged.
 *
 * **The modal is opened from INSIDE the dropdown, and the dropdown closes as it
 * opens.** The two are one surface at two scales, so the entry belongs where the
 * list is — a reader who has just scrolled past twenty repositories is the one
 * who wants the manage view — and leaving the dropdown open behind the modal
 * would put two lists on screen at once.
 */

import { useRef, useState } from 'preact/hooks';
import { Check, ChevronDown, FolderGit2, RotateCcw, Search, Settings2 } from 'lucide-preact';
import { useOnClickOutside } from '@/client/hooks/ui/on-click-outside';
import { RepoModal } from '@/client/components/workspace/repo-picker/Modal';
import { repoLabel, repoShortLabel } from '@/shared/lib/fs/repo-label';

interface GitRepoPickerProps {
  rootPath?: string;
  activeRepo: string;
  onSelectRepo: (repo: string) => void;
  /** Discovered repos of the active root; the panel owns discovery. */
  repos: string[];
  /** Discovery or a forced rescan is in flight. */
  scanning: boolean;
  onRefreshRepos: () => void;
}

export function GitRepoPicker({
  rootPath,
  activeRepo,
  onSelectRepo,
  repos,
  scanning,
  onRefreshRepos,
}: GitRepoPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useOnClickOutside(ref, () => setOpen(false));

  const filteredRepos = repos.filter((repo) => {
    if (!query.trim()) return true;
    return repoLabel(repo, rootPath).toLowerCase().includes(query.toLowerCase());
  });

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        title="Switch git project"
        className="flex items-center space-x-1.5 hover:bg-ink/5 px-2 py-1 rounded transition-colors text-xs text-ink/80 font-medium"
      >
        <FolderGit2 size={12} className="text-ink/60" />
        <span className="truncate max-w-[110px]">{repoShortLabel(activeRepo, rootPath)}</span>
        <ChevronDown size={12} className="text-ink/40" />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-52 bg-paper border border-ink/20 rounded-md shadow-lg z-50 flex flex-col overflow-hidden text-xs">
          <div className="px-2 py-1.5 border-b border-ink/10 flex items-center space-x-1.5">
            <Search size={11} className="text-ink/40 flex-shrink-0" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              placeholder="Search repos..."
              title="Search repositories"
              className="w-full bg-transparent outline-none text-xs text-ink placeholder-ink/40"
              autoFocus
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
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
              disabled={scanning}
              className="text-ink/40 hover:text-ink flex-shrink-0 transition-colors disabled:opacity-40 disabled:hover:text-ink/40"
            >
              <RotateCcw size={11} className={scanning ? 'animate-spin' : ''} />
            </button>
          </div>
          <div className="max-h-48 scrollbar-overlay-container py-1">
            {filteredRepos.length === 0 ? (
              <div className="px-3 py-2 text-ink/40 italic">No repos found</div>
            ) : (
              filteredRepos.map((repo) => (
                <button
                  key={repo}
                  type="button"
                  onClick={() => {
                    onSelectRepo(repo);
                    setOpen(false);
                    setQuery('');
                  }}
                  title={repoLabel(repo, rootPath)}
                  className="w-full text-left px-3 py-2 hover:bg-ink/5 flex items-center justify-between transition-colors"
                >
                  <span className="truncate">{repoLabel(repo, rootPath)}</span>
                  {activeRepo === repo && <Check size={12} className="text-ink flex-shrink-0" />}
                </button>
              ))
            )}
          </div>
          <div className="border-t border-ink/10">
            <button
              type="button"
              onClick={() => {
                setModalOpen(true);
                setOpen(false);
                setQuery('');
              }}
              className="w-full text-left px-3 py-2 hover:bg-ink/5 flex items-center space-x-2 transition-colors text-ink/80"
            >
              <Settings2 size={12} />
              <span>Manage repositories…</span>
            </button>
          </div>
        </div>
      )}

      <RepoModal
        isOpen={modalOpen}
        rootPath={rootPath}
        activeRepo={activeRepo}
        repos={repos}
        scanning={scanning}
        onSelectRepo={onSelectRepo}
        onRefreshRepos={onRefreshRepos}
        onClose={() => setModalOpen(false)}
      />
    </div>
  );
}
