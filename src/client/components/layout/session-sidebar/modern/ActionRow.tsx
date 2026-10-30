/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `modern` sidebar's action row: the primary action, then the actions.
 *
 * The classic toolbar spends its width on seven boxed controls and moves
 * whatever does not fit into a `⋯` menu measured against the panel's own width
 * (`sidebarToolbarCapacity`). That arithmetic exists because a row of BORDERS
 * cannot wrap. Here the split is by meaning instead:
 *
 * - **New Session** is the primary action and keeps its label at every width.
 * - **New Workspace**, **Scheduled** and **Refresh** are ACTIONS: bare glyphs in
 *   one cluster, so they cost 28px each instead of 28 + a border, and the row
 *   survives 264px without a measured overflow menu.
 * - **Sort** is a menu, and it says which order it is in — the classic toolbar
 *   can only show that through a pressed tint on an arrow glyph.
 *
 * Nothing here is a filter or a mode: search, focus, archive and batch selection
 * all live in the search line and the filter row above (`FilterChips`, which
 * picks between a trailing glyph and a fourth chip by measured width).
 */

import { ArrowUpDown, Calendar, FolderPlus, Plus, RefreshCw } from 'lucide-preact';
import { SortMenu } from '@/client/components/common/sort-menu';
import type { SessionSortOption } from '@/shared/types';

export interface SidebarActionRowProps {
  onNewSession: () => void;
  onNewWorkspace: () => void;
  onScheduler: () => void;
  scheduledCount: number;
  onRefresh: () => void;
  refreshing: boolean;
  sortOption: SessionSortOption;
  optionsOpen: boolean;
  onToggleOptions: () => void;
  onCloseOptions: () => void;
  onSortChange: (option: SessionSortOption) => void;
  /** Taller controls for a touch row. */
  touch?: boolean;
}

const GLYPH = 'shrink-0 inline-flex items-center justify-center rounded-md text-ink/55 transition-colors cursor-pointer hover:bg-ink/[0.06] hover:text-ink';
const GLYPH_ON = 'bg-ink/10 text-ink';

const SORT_LABEL: Record<SessionSortOption, string> = {
  'A-Z': 'A–Z',
  'Z-A': 'Z–A',
  LATEST_SESSION: 'Latest chat',
  LATEST_ADDED: 'Latest added',
};

export function SidebarActionRow({
  onNewSession,
  onNewWorkspace,
  onScheduler,
  scheduledCount,
  onRefresh,
  refreshing,
  sortOption,
  optionsOpen,
  onToggleOptions,
  onCloseOptions,
  onSortChange,
  touch = false,
}: SidebarActionRowProps) {
  const glyph = `${GLYPH} ${touch ? 'h-9 w-9' : 'h-7 w-7'}`;
  const schedulerLabel = scheduledCount > 0 ? `Scheduled tasks (${scheduledCount} armed)` : 'Scheduled tasks';

  return (
    <div className="flex items-center gap-1 px-3 pb-2">
      <button
        type="button"
        onClick={onNewSession}
        title="New Session"
        aria-label="New Session"
        className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md bg-ink px-2 font-semibold text-canvas transition-colors cursor-pointer hover:bg-ink/90 ${
          touch ? 'h-9 text-[13px]' : 'h-7 text-xs'
        }`}
      >
        <Plus size={touch ? 16 : 14} className="shrink-0" />
        <span className="truncate">New Session</span>
      </button>

      <div className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          onClick={onNewWorkspace}
          title="New Workspace"
          aria-label="New Workspace"
          className={glyph}
        >
          <FolderPlus size={touch ? 16 : 14} />
        </button>

        <button
          type="button"
          onClick={onScheduler}
          title={schedulerLabel}
          aria-label={scheduledCount > 0 ? `Scheduled tasks, ${scheduledCount} armed` : 'Scheduled tasks'}
          className={`relative ${glyph}`}
        >
          <Calendar size={touch ? 16 : 14} />
          {scheduledCount > 0 && (
            <span className="absolute right-0.5 top-0.5 min-w-[10px] rounded-full bg-ink px-[2px] text-center text-[7px] font-semibold leading-[10px] text-canvas">
              {scheduledCount > 9 ? '9+' : scheduledCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={onRefresh}
          title="Refresh sessions"
          aria-label="Refresh sessions"
          aria-busy={refreshing}
          className={glyph}
        >
          <RefreshCw size={touch ? 16 : 14} className={refreshing ? 'animate-spin' : ''} />
        </button>

        <div className="relative">
          <button
            type="button"
            onClick={onToggleOptions}
            title={`Sort: ${SORT_LABEL[sortOption]}`}
            aria-label={`Sort workspaces, currently ${SORT_LABEL[sortOption]}`}
            aria-haspopup="menu"
            aria-expanded={optionsOpen}
            className={`${glyph} ${optionsOpen || sortOption !== 'A-Z' ? GLYPH_ON : ''}`}
          >
            <ArrowUpDown size={touch ? 16 : 14} />
          </button>
          {optionsOpen && (
            <div
              className="absolute right-0 top-full z-50 mt-1 w-48 rounded-lg border border-ink/15 bg-paper py-1 shadow-lg"
              onMouseLeave={onCloseOptions}
            >
              <SortMenu variant="desktop" sortOption={sortOption} onSortChange={onSortChange} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
