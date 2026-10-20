import type { RefObject } from 'preact/compat';
import { Archive, ArrowUpDown, Calendar, FolderPlus, ListChecks, Plus, RefreshCw, Search, X } from 'lucide-preact';
import type { SessionSortOption } from '@/shared/types';
import { SortMenu } from '@/client/components/common/sort-menu';
import { ToolbarOverflowMenu } from '@/client/components/layout/session-sidebar/OverflowMenu';
import type { OverflowAction } from '@/client/components/layout/session-sidebar/OverflowMenu';
import { useToolbarRowWidth } from '@/client/hooks/workspace/toolbar-row-width';
import {
  MOBILE_TOOLBAR_PRIORITY,
  mobileToolbarCapacity,
} from '@/shared/lib/workspace/sidebar-toolbar';

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
  /** Enter the workspace batch-selection mode (checkbox on each workspace). */
  onSelectWorkspaces: () => void;
  /** True while a batch selection is active — the control reads pressed. */
  selecting: boolean;
}

/** One phone control's box — `w-9.5 h-9.5` with the toolbar's own border/shadow. */
const CONTROL_CLASS =
  'w-9.5 h-9.5 rounded-xl border active:scale-95 flex items-center justify-center transition-all flex-shrink-0 cursor-pointer shadow-xs';
const CONTROL_IDLE = 'border-ink/15 bg-paper hover:bg-ink/5 text-ink/80 hover:text-ink';
const CONTROL_ACTIVE = 'bg-ink/10 text-ink border-ink/30';

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
  onSelectWorkspaces,
  selecting,
}: MobileSessionToolbarProps) {
  // The row is measured, not breakpointed. The drawer is the device's width, and
  // the primary pill plus six 38px controls need 316px of row — more than a
  // 390px phone offers once the drawer's 24px of padding is gone. A
  // `@container` query could not fix that: it would keep hiding controls after
  // a tablet widened the drawer.
  const { ref: rowRef, width } = useToolbarRowWidth(0);
  const capacity = mobileToolbarCapacity(width);
  const visible: Record<string, true> = {};
  for (const control of MOBILE_TOOLBAR_PRIORITY.slice(0, capacity)) visible[control] = true;
  const hidden = MOBILE_TOOLBAR_PRIORITY.slice(capacity);

  const archiveLabel = showArchived ? 'Hide archived sessions' : 'Show archived sessions';
  const schedulerLabel = scheduledCount > 0 ? `Scheduled tasks (${scheduledCount} armed)` : 'Scheduled tasks';

  /** What the `⋯` menu offers, in priority order. */
  const overflowActions: OverflowAction[] = [];
  if (hidden.includes('new-workspace')) {
    overflowActions.push({ id: 'new-workspace', label: 'New Workspace', icon: FolderPlus, onSelect: onNewWorkspace });
  }
  if (hidden.includes('refresh')) {
    overflowActions.push({ id: 'refresh', label: 'Refresh sessions', icon: RefreshCw, onSelect: onRefresh });
  }
  if (hidden.includes('scheduler')) {
    overflowActions.push({ id: 'scheduler', label: schedulerLabel, icon: Calendar, onSelect: onScheduler });
  }
  if (hidden.includes('archive')) {
    overflowActions.push({ id: 'archive', label: archiveLabel, icon: Archive, onSelect: onToggleArchived, active: showArchived });
  }
  if (hidden.includes('select')) {
    overflowActions.push({
      id: 'select',
      label: selecting ? 'Cancel selection' : 'Select workspaces',
      icon: ListChecks,
      onSelect: onSelectWorkspaces,
      active: selecting,
    });
  }

  return (
    <div className="p-3 border-b border-ink/10 flex flex-col space-y-2.5 flex-shrink-0 bg-canvas">
      {/* Row 1: Primary + New Session Button & Quick Utility Buttons */}
      <div ref={rowRef} className="flex items-center space-x-2">
        {/* Large Ergonomic New Session Button. Its label is budgeted for in
            FULL by `mobileToolbarCapacity` (126px, the desktop row's rule), so
            it never ellipsises and never leaves the row: what gives way on a
            narrow drawer is a utility control, which moves into the `⋯` menu.
            `shrink-0` on the icon is the belt to that braces — measured with
            both as ordinary flex items, the label's `whitespace-nowrap`
            min-content refused to shrink and the `Plus` absorbed the whole
            shortfall (15px at 430, 1px at 412, 0px at 390/375/360), so the
            phone's primary action was a blank pill exactly where the drawer
            first dropped the label. The `aria-label` still carries the name
            for a screen reader. */}
        <button
          type="button"
          onClick={onNewSession}
          aria-label="New Session"
          title="New Session"
          className="flex-1 min-w-0 h-9.5 flex items-center justify-center space-x-2 px-3.5 rounded-xl bg-ink text-canvas hover:bg-ink/90 active:scale-[0.98] text-xs font-semibold transition-all shadow-xs"
        >
          <Plus size={15} strokeWidth={2.4} className="shrink-0" />
          <span className="min-w-0 truncate">New Session</span>
        </button>

        {visible['new-workspace'] && (
          <button
            type="button"
            onClick={onNewWorkspace}
            className={`${CONTROL_CLASS} ${CONTROL_IDLE}`}
            title="New Workspace"
            aria-label="New Workspace"
          >
            <FolderPlus size={16} strokeWidth={1.8} />
          </button>
        )}

        {/* Scheduler button. The badge is the whole point of the count: a
            button that opens a list you cannot see the state of reads as
            decorative, which is exactly what this control used to be. */}
        {visible['scheduler'] && (
          <button
            type="button"
            onClick={onScheduler}
            className={`relative ${CONTROL_CLASS} ${CONTROL_IDLE}`}
            title={schedulerLabel}
            aria-label={scheduledCount > 0 ? `Scheduled tasks, ${scheduledCount} armed` : 'Scheduled tasks'}
          >
            <Calendar size={16} strokeWidth={1.8} />
            {scheduledCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[13px] h-[13px] px-[3px] rounded-full bg-ink text-canvas text-[8px] leading-[13px] text-center font-semibold">
                {scheduledCount > 9 ? '9+' : scheduledCount}
              </span>
            )}
          </button>
        )}

        {/* Archive toggle — its own button, the same shape as Scheduler's.
            It used to live inside the sort dropdown under a "Filter" heading,
            which made a view filter look like a sort mode: the control that
            decides whether archived rows are on screen was hidden one tap
            deeper than the control that reorders them. */}
        {visible['archive'] && (
          <button
            type="button"
            onClick={onToggleArchived}
            aria-pressed={showArchived}
            className={`${CONTROL_CLASS} ${showArchived ? 'bg-amber-500/15 border-amber-500/40 text-amber-900' : CONTROL_IDLE}`}
            title={archiveLabel}
            aria-label={archiveLabel}
          >
            <Archive size={16} strokeWidth={1.8} />
          </button>
        )}

        {/* Batch selection over the WORKSPACES. A mode, like search, so it
            sits with the view controls and reports its pressed state — and it
            is the only way into the workspace batch, because a workspace has
            no row of its own to long-press. */}
        {visible['select'] && (
          <button
            type="button"
            onClick={onSelectWorkspaces}
            aria-pressed={selecting}
            className={`${CONTROL_CLASS} ${selecting ? CONTROL_ACTIVE : CONTROL_IDLE}`}
            title={selecting ? 'Cancel selection' : 'Select workspaces'}
            aria-label={selecting ? 'Cancel selection' : 'Select workspaces'}
          >
            <ListChecks size={16} strokeWidth={1.8} />
          </button>
        )}

        {/* Refresh sessions button — same action the desktop toolbar's
            RefreshCw performs: refetch the session list from the server.
            The icon spins for the duration of that fetch, so the click has a
            visible end; `refreshing` is raised only by this button's own load. */}
        {visible['refresh'] && (
          <button
            type="button"
            onClick={onRefresh}
            className={`${CONTROL_CLASS} ${CONTROL_IDLE}`}
            title="Refresh sessions"
            aria-label="Refresh sessions"
            aria-busy={refreshing}
          >
            <RefreshCw size={15} strokeWidth={1.8} className={refreshing ? 'animate-spin' : undefined} />
          </button>
        )}

        {/* Sort Dropdown. Archive is NOT in here any more — it has its own
            button in this row, so this control means one thing (the order of
            the list) and its pressed state reads the sort alone. */}
        {visible['sort'] && (
          <div className="relative flex-shrink-0" ref={optionsRef}>
            <button
              type="button"
              onClick={onToggleOptions}
              className={`${CONTROL_CLASS} ${optionsOpen || sortOption !== 'A-Z' ? CONTROL_ACTIVE : CONTROL_IDLE}`}
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
        )}

        {/* Whatever the row could not hold. The sort control's own options
            travel with it, so a narrow drawer can still reorder the list. */}
        {hidden.length > 0 && (
          <ToolbarOverflowMenu
            actions={overflowActions}
            sortHidden={hidden.includes('sort')}
            sortOption={sortOption}
            onSortChange={onSortChange}
            layout="mobile"
          />
        )}
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
