import { GitMerge, History, RotateCw, Search, X } from 'lucide-preact';
import { formatCommitCount } from '@/shared/lib/fs/commit-count';

interface HeaderProps {
  isGraphMode: boolean;
  onToggleMode: (graph: boolean) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onRefresh: () => void;
  onClose: () => void;
  isRefreshing?: boolean;
  /** Rows currently rendered (the loaded page, or its search matches). */
  totalCommits: number;
  /** Rows held in the modal, before the search filter. */
  loadedCount: number;
  /** The branch's real commit count, when the response carried it. */
  totalCount?: number;
  hasMore?: boolean;
}

export function Header({
  isGraphMode,
  onToggleMode,
  searchQuery,
  onSearchChange,
  onRefresh,
  onClose,
  isRefreshing,
  totalCommits,
  loadedCount,
  totalCount,
  hasMore,
}: HeaderProps) {
  // What the badge reports, in order of what is actually known:
  //   searching    → "12 of 50 loaded"  (matches, against the loaded page)
  //   more on disk → "50 of 646"        (loaded, against the branch total)
  //   complete     → "646 commits"
  const badge = formatCommitCount({
    matches: totalCommits,
    loaded: loadedCount,
    total: totalCount,
    hasMore,
    isFiltering: searchQuery.trim().length > 0,
  });
  return (
    <div
      className="flex flex-col gap-2 px-3 lg:px-5 py-3 border-b border-ink/10 bg-paper select-none
        pl-[max(0.75rem,env(safe-area-inset-left,0px))] pr-[max(0.75rem,env(safe-area-inset-right,0px))]"
    >
      <div className="flex items-center justify-between gap-2 lg:gap-4">
        {/* Title and Subtitle */}
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <h2 className="text-base font-semibold text-ink tracking-tight">
              {isGraphMode ? 'Graph' : 'History'}
            </h2>
            <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-ink/5 text-ink/80 border border-ink/10 whitespace-nowrap">
              {badge}
            </span>
          </div>
          <p className="text-xs text-muted mt-0.5 hidden lg:block">
            {isGraphMode
              ? 'Follow branch topology and inspect commits.'
              : 'Browse recent commits and inspect changed files.'}
          </p>
        </div>

        {/* Action Controls on the Right */}
        <div className="flex items-center gap-1.5 lg:gap-2 flex-shrink-0">
          {/* Mode Switcher. The phone drops the segmented-control plate: three
              icon-only controls in a row read as one cluster, and the plate
              plus the refresh border made them look like three separate
              widgets. The active tab keeps its own rect, with the glyph
              centred in it. */}
          <div className="flex items-center text-xs lg:bg-ink/5 lg:p-0.5 lg:rounded-lg lg:border lg:border-ink/10">
            <button
              type="button"
              onClick={() => onToggleMode(false)}
              title="History view"
              aria-label="History view"
              aria-pressed={!isGraphMode}
              className={`tap-target flex items-center justify-center gap-1.5 p-2 rounded-md font-medium transition-colors cursor-pointer lg:px-2.5 lg:py-1 ${
                !isGraphMode
                  ? 'bg-ink/5 text-ink lg:bg-paper lg:shadow-xs'
                  : 'text-ink/80 lg:hover:text-ink lg:hover:bg-ink/5'
              }`}
            >
              <History size={13} aria-hidden="true" />
              <span className="hidden lg:inline">History</span>
            </button>
            <button
              type="button"
              onClick={() => onToggleMode(true)}
              title="Graph view"
              aria-label="Graph view"
              aria-pressed={isGraphMode}
              className={`tap-target flex items-center justify-center gap-1.5 p-2 rounded-md font-medium transition-colors cursor-pointer lg:px-2.5 lg:py-1 ${
                isGraphMode
                  ? 'bg-ink/5 text-ink lg:bg-paper lg:shadow-xs'
                  : 'text-ink/80 lg:hover:text-ink lg:hover:bg-ink/5'
              }`}
            >
              <GitMerge size={13} aria-hidden="true" />
              <span className="hidden lg:inline">Graph</span>
            </button>
          </div>

          {/* Refresh Button */}
          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            className="tap-target flex items-center justify-center gap-1.5 p-2 rounded-md text-ink/70 transition-colors cursor-pointer text-xs disabled:opacity-40 lg:px-2.5 lg:py-1.5 lg:border lg:border-ink/15 lg:hover:bg-ink/5 lg:hover:text-ink"
            title="Refresh commit history"
            aria-label="Refresh commit history"
          >
            <RotateCw size={13} className={isRefreshing ? 'animate-spin text-ink' : ''} aria-hidden="true" />
            <span className="hidden lg:inline">Refresh</span>
          </button>

          {/* Close Button */}
          <button
            type="button"
            onClick={onClose}
            className="tap-target p-2 -mr-1 rounded-md hover:bg-ink/5 text-muted hover:text-ink transition-colors cursor-pointer"
            title="Close modal"
            aria-label="Close commit history"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Search Input Filter */}
      <div className="relative mt-1">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink/55" aria-hidden="true" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.currentTarget.value)}
          placeholder="Filter commits by message, author, or hash..."
          aria-label="Filter commits"
          className="w-full bg-ink/[0.03] border border-ink/15 rounded-md pl-8 pr-3 py-1.5 text-xs text-ink placeholder-ink/40 focus:outline-none focus:border-ink/40 transition-colors font-mono"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => onSearchChange('')}
            aria-label="Clear filter"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink/55 hover:text-ink cursor-pointer"
          >
            <X size={12} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
