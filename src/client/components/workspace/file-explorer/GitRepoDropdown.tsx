
import { useRef, useState } from 'preact/hooks';
import { Check, ChevronDown, FolderGit2, RotateCcw, Search } from 'lucide-preact';
import { useOnClickOutside } from '@/client/hooks/ui/on-click-outside';

interface GitRepoDropdownProps {
  rootPath?: string;
  activeRepo: string;
  onSelectRepo: (repo: string) => void;
  /** Discovered repos of the active root; the panel owns discovery. */
  repos: string[];
  /** Discovery or a forced rescan is in flight. */
  scanning: boolean;
  onRefreshRepos: () => void;
}

function workspaceFolderName(rootPath?: string): string {
  if (!rootPath) return 'workspace root';
  const parts = rootPath.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : 'workspace root';
}

export function GitRepoDropdown({
  rootPath,
  activeRepo,
  onSelectRepo,
  repos,
  scanning,
  onRefreshRepos,
}: GitRepoDropdownProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const rootLabel = workspaceFolderName(rootPath);

  const label = (r: string) => (r === '.' ? rootLabel : r);

  useOnClickOutside(ref, () => setOpen(false));

  const filteredRepos = repos.filter(r => {
    if (!query.trim()) return true;
    return label(r).toLowerCase().includes(query.toLowerCase());
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
        <span className="truncate max-w-[110px]">{activeRepo === '.' ? rootLabel : activeRepo.split('/').pop()}</span>
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
              filteredRepos.map(r => (
                <button
                  key={r}
                  type="button"
                  onClick={() => {
                    onSelectRepo(r);
                    setOpen(false);
                    setQuery('');
                  }}
                  title={label(r)}
                  className="w-full text-left px-3 py-2 hover:bg-ink/5 flex items-center justify-between transition-colors"
                >
                  <span className="truncate">{label(r)}</span>
                  {activeRepo === r && <Check size={12} className="text-ink" />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
