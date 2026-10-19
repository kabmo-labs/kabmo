import { Archive, ArrowUpDown, Calendar, FolderPlus, Plus, RefreshCw, Search, X } from 'lucide-preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { SessionSortOption } from '@/shared/types';
import { SortMenu } from '@/client/components/common/sort-menu';
import { ToolbarOverflowMenu } from '@/client/components/layout/session-sidebar/OverflowMenu';
import type { OverflowAction } from '@/client/components/layout/session-sidebar/OverflowMenu';
import {
  SIDEBAR_TOOLBAR_PRIORITY,
  TOOLBAR_ROW_PADDING_PX,
  sidebarToolbarCapacity,
} from '@/shared/lib/workspace/sidebar-toolbar';

interface SessionSidebarToolbarProps {
  isSearchVisible: boolean;
  searchQuery: string;
  showArchived: boolean;
  optionsOpen: boolean;
  sortOption: SessionSortOption;
  onToggleSearch: () => void;
  onSearchChange: (value: string) => void;
  onToggleArchived: () => void;
  onHideArchived: () => void;
  onToggleOptions: () => void;
  onCloseOptions: () => void;
  onSortChange: (opt: SessionSortOption) => void;
  /** Opens the pending `new-…` chat — the primary action of the sidebar. */
  onNewSession: () => void;
  onNewWorkspace: () => void;
  onScheduler: () => void;
  /** Armed scheduled tasks, for the Calendar button's badge. */
  scheduledCount: number;
  onRefresh: () => void;
  /** True while the user-initiated refresh is in flight — spins the icon. */
  refreshing: boolean;
}

/**
 * The row's content width, kept current as the sidebar is dragged.
 *
 * The capacity decision needs the width the row actually has, and the sidebar
 * is resizable — a `ResizeObserver` is what makes the set of visible controls
 * follow a drag instead of being decided once at mount.
 */
function useRowWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  // A layout effect, so the first measure lands BEFORE paint: with a passive
  // effect the row drew every control and then dropped the ones that did not
  // fit on the next frame.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    // `clientWidth` includes the row's own `px-1`, and the capacity budget is
    // a CONTENT width — leaving the padding in made the row 8px optimistic,
    // which is exactly the margin an extra icon needs.
    const measure = () => setWidth(Math.max(0, element.clientWidth - TOOLBAR_ROW_PADDING_PX));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    // The sidebar is resizable, so the visible set has to follow a drag
    // instead of being decided once at mount.
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

const ICON_CLASS = 'shrink-0 w-7 h-7 inline-flex items-center justify-center rounded border transition-colors cursor-pointer';
const ICON_IDLE = 'border-ink/15 bg-paper text-ink/70 hover:bg-ink/5 hover:text-ink';
const ICON_ACTIVE = 'border-ink/30 bg-ink/10 text-ink';

export function SessionSidebarToolbar({
  isSearchVisible,
  searchQuery,
  showArchived,
  optionsOpen,
  sortOption,
  onToggleSearch,
  onSearchChange,
  onToggleArchived,
  onHideArchived,
  onToggleOptions,
  onCloseOptions,
  onSortChange,
  onNewSession,
  onNewWorkspace,
  onScheduler,
  scheduledCount,
  onRefresh,
  refreshing,
}: SessionSidebarToolbarProps) {
  const { ref: rowRef, width } = useRowWidth();
  const capacity = sidebarToolbarCapacity(width);
  const visible = new Set(SIDEBAR_TOOLBAR_PRIORITY.slice(0, capacity));
  const hidden = SIDEBAR_TOOLBAR_PRIORITY.slice(capacity);

  const archiveLabel = showArchived ? 'Hide Archive' : 'Show Archive';
  const schedulerLabel = scheduledCount > 0 ? `Scheduled tasks (${scheduledCount} armed)` : 'Scheduled tasks';

  /** What the `⋯` menu offers, in priority order. */
  const overflowActions: OverflowAction[] = [];
  if (hidden.includes('new-workspace')) {
    overflowActions.push({ id: 'new-workspace', label: 'New Workspace', icon: FolderPlus, onSelect: onNewWorkspace });
  }
  if (hidden.includes('refresh')) {
    overflowActions.push({ id: 'refresh', label: 'Refresh sessions', icon: RefreshCw, onSelect: onRefresh });
  }
  if (hidden.includes('search')) {
    overflowActions.push({ id: 'search', label: 'Search sessions', icon: Search, onSelect: onToggleSearch, active: isSearchVisible });
  }
  if (hidden.includes('archive')) {
    overflowActions.push({ id: 'archive', label: archiveLabel, icon: Archive, onSelect: onToggleArchived, active: showArchived });
  }
  if (hidden.includes('scheduler')) {
    overflowActions.push({ id: 'scheduler', label: schedulerLabel, icon: Calendar, onSelect: onScheduler });
  }

  return (
    <div className="p-3 border-b border-ink/10 flex flex-col space-y-3">
      <div
        ref={rowRef}
        className="flex items-center justify-between gap-2 px-1 text-ink/60"
      >
        <div className="flex flex-1 min-w-0 items-center gap-1.5">
          {/* New Session is the sidebar's primary action and sits immediately
              before New Workspace — the same order the phone's drawer uses, so
              the control does not move between layouts. Its label is NEVER
              hidden: `truncate` ellipsises it once the row runs short. Every
              button in the row is `h-7` and the utilities are boxed, the
              phone's rule: one row of equally sized controls rather than a pill
              beside bare glyphs. */}
          <button
            type="button"
            title="New Session"
            aria-label="New Session"
            onClick={onNewSession}
            className="flex-1 min-w-[52px] h-7 flex items-center justify-center space-x-1.5 px-2 rounded bg-ink text-canvas text-xs font-semibold hover:bg-ink/90 transition-colors cursor-pointer"
          >
            <Plus size={14} className="shrink-0" />
            <span className="truncate">New Session</span>
          </button>

          {/* A control that does not fit is NOT drawn on the row: it moves into
              the `⋯` menu below, which is the one slot the row reserves for it.
              The set is decided by measured width, not by a media query — the
              sidebar is resizable, and a `@container` breakpoint would keep
              hiding controls after the user widened it. */}
          {visible.has('new-workspace') && (
            <button
              type="button"
              title="New Workspace"
              aria-label="New Workspace"
              onClick={onNewWorkspace}
              className={`${ICON_CLASS} ${ICON_IDLE}`}
            >
              <FolderPlus size={14} />
            </button>
          )}
          {visible.has('scheduler') && (
            <button
              type="button"
              title={schedulerLabel}
              aria-label={scheduledCount > 0 ? `Scheduled tasks, ${scheduledCount} armed` : 'Scheduled tasks'}
              onClick={onScheduler}
              className={`relative ${ICON_CLASS} ${ICON_IDLE}`}
            >
              <Calendar size={14} />
              {scheduledCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[10px] h-[10px] px-[2px] rounded-full bg-ink text-canvas text-[7px] leading-[10px] text-center font-semibold">
                  {scheduledCount > 9 ? '9+' : scheduledCount}
                </span>
              )}
            </button>
          )}
          {visible.has('refresh') && (
            <button
              type="button"
              title="Refresh sessions"
              onClick={onRefresh}
              className={`${ICON_CLASS} ${ICON_IDLE}`}
              aria-label="Refresh sessions"
              aria-busy={refreshing}
            >
              <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            </button>
          )}
        </div>

        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          {visible.has('search') && (
            <button
              type="button"
              title={isSearchVisible ? 'Hide search' : 'Search sessions'}
              aria-label={isSearchVisible ? 'Hide search' : 'Search sessions'}
              aria-pressed={isSearchVisible}
              onClick={onToggleSearch}
              className={`${ICON_CLASS} ${isSearchVisible ? ICON_ACTIVE : ICON_IDLE}`}
            >
              <Search size={14} />
            </button>
          )}
          {visible.has('archive') && (
            <button
              type="button"
              title={archiveLabel}
              aria-label={archiveLabel}
              aria-pressed={showArchived}
              onClick={onToggleArchived}
              className={`${ICON_CLASS} ${showArchived ? ICON_ACTIVE : ICON_IDLE}`}
            >
              <Archive size={14} />
            </button>
          )}
          {visible.has('sort') && (
            <div className="relative">
              <button
                type="button"
                title="Sort workspaces"
                aria-label="Sort workspaces"
                aria-haspopup="menu"
                aria-expanded={optionsOpen}
                onClick={onToggleOptions}
                className={`${ICON_CLASS} ${optionsOpen || sortOption !== 'A-Z' ? ICON_ACTIVE : ICON_IDLE}`}
              >
                <ArrowUpDown size={14} />
              </button>
              {optionsOpen && (
                <div className="absolute right-0 top-full mt-2 w-48 bg-paper border border-ink/15 rounded-lg shadow-lg z-50 py-1" onMouseLeave={onCloseOptions}>
                  <SortMenu variant="desktop" sortOption={sortOption} onSortChange={onSortChange} />
                </div>
              )}
            </div>
          )}
          {overflowActions.length > 0 && (
            <ToolbarOverflowMenu
              actions={overflowActions}
              sortHidden={hidden.includes('sort')}
              sortOption={sortOption}
              onSortChange={onSortChange}
            />
          )}
        </div>
      </div>

      {/* Search Field */}
      {isSearchVisible && (
        <div className="pt-1">
          <input 
            type="text" 
            placeholder="Search workspaces & sessions..." 
            value={searchQuery}
            onChange={(e) => onSearchChange(e.currentTarget.value)}
            autoFocus
            className="w-full bg-ink/5 border border-ink/10 rounded px-2.5 py-1.5 outline-none focus:border-ink/30 text-xs text-ink placeholder-ink/40 transition-colors" 
          />
        </div>
      )}
      
      {/* Archive Status Pill */}
      {showArchived && (
        <div className="flex items-center justify-between bg-amber-500/10 border border-amber-500/20 text-amber-900 rounded px-2.5 py-1.5 text-[10px] font-medium">
          <div className="flex items-center space-x-1.5">
            <Archive size={10} />
            <span>Showing Archived</span>
          </div>
          <button className="hover:text-amber-950" onClick={onHideArchived}>
            <X size={10} />
          </button>
        </div>
      )}
    </div>
  );
}
