import type { RefObject } from 'preact/compat';
import { Archive, ArrowUpDown, Calendar, FolderPlus, Plus, RefreshCw, Search, X } from 'lucide-preact';
import type { SessionSortOption } from '@/shared/types';
import { SortMenu } from '@/client/components/common/sort-menu';

export interface MobileSessionToolbarProps {
  searchQuery: string;
  sortOption: SessionSortOption;
  optionsOpen: boolean;
  showArchived: boolean;
  optionsRef: RefObject<HTMLDivElement>;
  onNewSession: () => void;
  onNewWorkspace: () => void;
  onScheduler: () => void;
  /** Armed scheduled tasks, for the Calendar button's badge. */
  scheduledCount: number;
  onRefresh: () => void;
  /** True while the user-initiated refresh is in flight — spins the icon. */
  refreshing: boolean;
  onToggleOptions: () => void;
  onSortChange: (opt: SessionSortOption) => void;
  onResetSort: () => void;
  onToggleArchived: () => void;
  onHideArchived: () => void;
  onSearchChange: (value: string) => void;
  onClearSearch: () => void;
}

export function MobileSessionToolbar({
  searchQuery,
  sortOption,
  optionsOpen,
  showArchived,
  optionsRef,
  onNewSession,
  onNewWorkspace,
  onScheduler,
  scheduledCount,
  onRefresh,
  refreshing,
  onToggleOptions,
  onSortChange,
  onResetSort,
  onToggleArchived,
  onHideArchived,
  onSearchChange,
  onClearSearch,
}: MobileSessionToolbarProps) {
  return (
    <div className="@container p-3 border-b border-ink/10 flex flex-col space-y-2.5 flex-shrink-0 bg-canvas">
      {/* Row 1: Primary + New Session Button & Quick Utility Buttons */}
      <div className="flex items-center space-x-2">
        {/* Large Ergonomic New Session Button. Its label drops below a narrow
            drawer (@container, not the viewport) so the five fixed-size utility
            buttons beside it can never squeeze it past the row's own width.
            Measured: the row needs 356px of CONTAINER for the label to fit
            (190px of buttons + 40px of gaps + 51px of icon/padding + the 75px
            label), and the container is the viewport minus the toolbar's 12px
            of padding each side — so 360px of container (a 384px viewport)
            is the point the label stops fitting. The `aria-label` is not
            optional: hiding the visible text would otherwise leave the button
            with no accessible name at all, which is what a phone-width
            screen reader reads first. */}
        <button
          type="button"
          onClick={onNewSession}
          aria-label="New Session"
          title="New Session"
          className="flex-1 min-w-0 h-9.5 flex items-center justify-center space-x-2 px-3.5 rounded-xl bg-ink text-canvas hover:bg-ink/90 active:scale-[0.98] text-xs font-semibold transition-all shadow-xs"
        >
          <Plus size={15} strokeWidth={2.4} />
          <span className="hidden @[360px]:inline whitespace-nowrap">New Session</span>
        </button>

        {/* New Workspace / Folder button */}
        <button
          type="button"
          onClick={onNewWorkspace}
          className="w-9.5 h-9.5 rounded-xl border border-ink/15 bg-paper hover:bg-ink/5 active:scale-95 text-ink/80 hover:text-ink flex items-center justify-center transition-all flex-shrink-0 cursor-pointer shadow-xs"
          title="New Workspace"
          aria-label="New Workspace"
        >
          <FolderPlus size={16} strokeWidth={1.8} />
        </button>

        {/* Scheduler button. The badge is the whole point of the count: a
            button that opens a list you cannot see the state of reads as
            decorative, which is exactly what this control used to be. */}
        <button
          type="button"
          onClick={onScheduler}
          className="relative w-9.5 h-9.5 rounded-xl border border-ink/15 bg-paper hover:bg-ink/5 active:scale-95 text-ink/80 hover:text-ink flex items-center justify-center transition-all flex-shrink-0 cursor-pointer shadow-xs"
          title={scheduledCount > 0 ? `Scheduled tasks (${scheduledCount} armed)` : 'Scheduled tasks'}
          aria-label={scheduledCount > 0 ? `Scheduled tasks, ${scheduledCount} armed` : 'Scheduled tasks'}
        >
          <Calendar size={16} strokeWidth={1.8} />
          {scheduledCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[13px] h-[13px] px-[3px] rounded-full bg-ink text-canvas text-[8px] leading-[13px] text-center font-semibold">
              {scheduledCount > 9 ? '9+' : scheduledCount}
            </span>
          )}
        </button>

        {/* Archive toggle — its own button, the same shape as Scheduler's.
            It used to live inside the sort dropdown under a "Filter" heading,
            which made a view filter look like a sort mode: the control that
            decides whether archived rows are on screen was hidden one tap
            deeper than the control that reorders them. The pressed state is
            carried by the button itself (and by the pill in row 3), so the
            dropdown no longer needs to report it. */}
        <button
          type="button"
          onClick={onToggleArchived}
          aria-pressed={showArchived}
          className={`w-9.5 h-9.5 rounded-xl border active:scale-95 flex items-center justify-center transition-all flex-shrink-0 cursor-pointer shadow-xs ${
            showArchived
              ? 'bg-amber-500/15 border-amber-500/40 text-amber-900'
              : 'border-ink/15 bg-paper hover:bg-ink/5 text-ink/80 hover:text-ink'
          }`}
          title={showArchived ? 'Hide archived sessions' : 'Show archived sessions'}
          aria-label={showArchived ? 'Hide archived sessions' : 'Show archived sessions'}
        >
          <Archive size={16} strokeWidth={1.8} />
        </button>

        {/* Refresh sessions button — same action the desktop toolbar's
            RefreshCw performs: refetch the session list from the server.
            The icon spins for the duration of that fetch, so the click has a
            visible end; `refreshing` is raised only by this button's own load. */}
        <button
          type="button"
          onClick={onRefresh}
          className="w-9.5 h-9.5 rounded-xl border border-ink/15 bg-paper hover:bg-ink/5 active:scale-95 text-ink/80 hover:text-ink flex items-center justify-center transition-all flex-shrink-0 cursor-pointer shadow-xs"
          title="Refresh sessions"
          aria-label="Refresh sessions"
          aria-busy={refreshing}
        >
          <RefreshCw size={15} strokeWidth={1.8} className={refreshing ? 'animate-spin' : undefined} />
        </button>

        {/* Sort Dropdown. Archive is NOT in here any more — it has its own
            button in this row, so this control means one thing (the order of
            the list) and its pressed state reads the sort alone. */}
        <div className="relative flex-shrink-0" ref={optionsRef}>
          <button
            type="button"
            onClick={onToggleOptions}
            className={`w-9.5 h-9.5 rounded-xl border active:scale-95 flex items-center justify-center transition-all cursor-pointer shadow-xs ${
              optionsOpen || sortOption !== 'A-Z'
                ? 'bg-ink/10 text-ink border-ink/30' 
                : 'border-ink/15 bg-paper hover:bg-ink/5 text-ink/80 hover:text-ink'
            }`}
            title="Sort workspaces"
            aria-label="Sort workspaces"
          >
            <ArrowUpDown size={15} strokeWidth={1.8} />
          </button>

          {optionsOpen && (
            <div className="absolute right-0 top-full mt-2 w-52 bg-paper border border-ink/15 rounded-xl shadow-xl z-50 p-2 text-xs">
              <SortMenu variant="mobile" sortOption={sortOption} onSortChange={onSortChange} />
            </div>
          )}
        </div>
      </div>

      {/* Row 2: Search Input Bar */}
      <div className="relative flex items-center">
        <Search size={14} className="absolute left-3 text-ink/40" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.currentTarget.value)}
          placeholder="Search workspaces & sessions..."
          className="w-full bg-paper border border-ink/15 rounded-xl pl-8 pr-8 py-2 text-xs text-ink placeholder-ink/40 focus:outline-none focus:border-ink/40 transition-colors font-mono"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={onClearSearch}
            className="absolute right-2.5 text-ink/40 hover:text-ink p-1"
            aria-label="Clear search"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {/* Row 3: Active Filters Pills (if sort or archive changed from defaults) */}
      {(showArchived || sortOption !== 'A-Z') && (
        <div className="flex items-center space-x-1.5 flex-wrap gap-y-1 pt-0.5">
          {sortOption !== 'A-Z' && (
            <span className="inline-flex items-center space-x-1 bg-ink/5 border border-ink/10 text-ink/80 rounded-lg px-2 py-0.5 text-[10px] font-mono">
              <span>Sort: {sortOption.replace('_', ' ')}</span>
              <button 
                type="button" 
                onClick={onResetSort} 
                className="hover:text-ink ml-0.5"
                title="Reset sort"
              >
                <X size={10} />
              </button>
            </span>
          )}
          {showArchived && (
            <span className="inline-flex items-center space-x-1 bg-amber-500/15 border border-amber-500/25 text-amber-900 rounded-lg px-2 py-0.5 text-[10px] font-mono">
              <Archive size={10} />
              <span>Archived</span>
              <button 
                type="button" 
                onClick={onHideArchived} 
                className="hover:text-amber-950 ml-0.5"
                title="Hide archived"
              >
                <X size={10} />
              </button>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
