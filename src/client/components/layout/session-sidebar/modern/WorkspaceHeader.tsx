/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A workspace's header in the `modern` sidebar: the mark, the name, how many
 * chats it holds, and its two actions.
 *
 * Differences from the classic header are presentation only, and each one is
 * there for a reason:
 *
 * - **It sticks.** Scrolling a long workspace used to leave the rows with no
 *   visible owner; the name is the only thing that says which project these
 *   chats belong to.
 * - **It states a count.** "3" answers "does this workspace have anything in
 *   it?" without expanding it, which is the question a collapsed row raises.
 * - **The mark keeps the accent.** A folder's colour is a fact the user chose;
 *   the classic header only shows it until hover, when the chevron replaces it.
 *   Here the accent is a dot beside the name, so it survives both states.
 *
 * ## The gutter is shared with the rows, numerically
 *
 * The icon column, the title column and the TRAILING column are the same columns
 * as a session row's (`common/session-row`): 4px of inset, a 16px slot (18px on
 * touch), then 8px before the text; and on the right, a 22px (28px on touch)
 * action box ending 4px inside the list's content edge. Measured before this
 * rule existed, the folder mark's centre sat at x=20 while the row's status glyph
 * sat at 24, the folder name at 34 while the session title started at 40, and the
 * two `⋯` triggers were 9px apart (8px vs 16px from the panel edge) — three steps
 * that made the list look like two lists. A header that "looked about right" is
 * what produced them: the pair has to be stated, so it is stated here and in
 * `session-row`.
 *
 * The actions are the same components the classic header uses — `＋` opens a
 * chat in THIS folder and `⋯` is `WorkspaceOptionsMenu` — so pin, delete,
 * reveal, worktree and session-selection exist in both styles by construction.
 */

import type { ReactNode } from 'preact/compat';
import { ChevronDown, ChevronRight, MoreHorizontal, Pin, Plus } from 'lucide-preact';
import { SelectionCheckbox } from '@/client/components/common/batch-selection/SelectionCheckbox';
import type { CategoryHeaderCheckbox } from '@/client/components/layout/session-sidebar/CategoryHeader';
import { getProjectIcon } from '@/shared/lib/workspace/project-icon';
import type { WorkspaceFolderData } from '@/shared/types';

export interface WorkspaceHeaderProps {
  folder: WorkspaceFolderData;
  isOpen: boolean;
  onToggleFolder: () => void;
  /** Rows the folder offers under the current archive filter. */
  sessionCount: number;
  checkbox: CategoryHeaderCheckbox | null;
  batchActive: boolean;
  menuRef: { current: HTMLDivElement | null };
  showMenu: boolean;
  onToggleMenu: () => void;
  onNewSession: () => void;
  /** The menu body, drawn in this header's anchored container while open. */
  menu?: ReactNode;
  /** Taller row and larger tap targets for the phone drawer. */
  touch?: boolean;
}

export function WorkspaceHeader({
  folder,
  isOpen,
  onToggleFolder,
  sessionCount,
  checkbox,
  batchActive,
  menuRef,
  showMenu,
  onToggleMenu,
  onNewSession,
  menu,
  touch = false,
}: WorkspaceHeaderProps) {
  const ProjectIcon = getProjectIcon(folder.icon);
  const accent = folder.accentColor || undefined;

  return (
    <div
      className={`group/ws sticky top-0 z-10 -mx-1 flex items-center gap-1 rounded-md bg-paper px-1 text-xs font-semibold text-ink ${
        touch ? 'h-8' : 'h-[26px]'
      }`}
    >
      <button
        type="button"
        onClick={batchActive ? undefined : onToggleFolder}
        aria-expanded={isOpen}
        aria-label={`${folder.name}${isOpen ? ', collapse' : ', expand'}`}
        className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-md px-1 text-left cursor-pointer hover:bg-ink/[0.04]"
      >
        {checkbox ? (
          <SelectionCheckbox
            size="md"
            checked={checkbox.checked}
            indeterminate={checkbox.indeterminate}
            label={checkbox.label}
            onChange={checkbox.onChange}
          />
        ) : (
          <span className={`relative flex shrink-0 items-center justify-center ${touch ? 'h-[18px] w-[18px]' : 'h-4 w-4'}`}>
            {folder.customIconUrl ? (
              <img
                src={folder.customIconUrl}
                alt=""
                className="h-[15px] w-[15px] shrink-0 rounded-xs object-contain"
                referrerPolicy="no-referrer"
              />
            ) : (
              <ProjectIcon size={15} className="text-ink/70" style={{ color: accent }} />
            )}
          </span>
        )}

        <span className="truncate text-[13px] font-semibold tracking-tight">{folder.name}</span>
        {folder.isPinned && <Pin size={10} className="shrink-0 text-ink/45" />}

        {/* The accent as a dot: the icon column keeps the chevron's slot, so the
            colour needs a place that is not hover-dependent. */}
        {accent && !checkbox && (
          <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: accent }} />
        )}

        <span className="shrink-0 font-mono text-[10px] font-normal tabular-nums text-ink/35">{sessionCount}</span>

        <span className="ml-auto shrink-0 text-ink/40">
          {isOpen ? <ChevronDown size={touch ? 14 : 12} /> : <ChevronRight size={touch ? 14 : 12} />}
        </span>
      </button>

      {/* `pr-1`: the action cluster ends where a session row's trailing control
          ends (4px inside the list's content edge), so the two `⋯` columns are
          one column — measured before this rule, the folder's sat 8px from the
          panel edge and the row's 16px, a 9px step between glyph centres. */}
      {!batchActive && (
        <div className="flex shrink-0 items-center gap-0.5 pr-1">
          <button
            type="button"
            title="New Session"
            aria-label={`New session in ${folder.name}`}
            onClick={(event) => {
              event.stopPropagation();
              onNewSession();
            }}
            className={`flex items-center justify-center rounded text-ink/40 transition-colors cursor-pointer hover:bg-ink/10 hover:text-ink ${
              touch ? 'h-7 w-7' : 'h-[22px] w-[22px]'
            }`}
          >
            <Plus size={touch ? 15 : 12} />
          </button>

          <div className="relative flex items-center" ref={menuRef}>
            <button
              type="button"
              title={`Options for ${folder.name}`}
              aria-label={`Options for ${folder.name}`}
              aria-haspopup="menu"
              aria-expanded={showMenu}
              onClick={(event) => {
                event.stopPropagation();
                onToggleMenu();
              }}
              className={`flex items-center justify-center rounded text-ink/40 transition-colors cursor-pointer hover:bg-ink/10 hover:text-ink ${
                touch ? 'h-7 w-7' : 'h-[22px] w-[22px]'
              }`}
            >
              <MoreHorizontal size={touch ? 15 : 12} />
            </button>
            {/* The menu body is the caller's: it owns the state the menu acts
                on (pin, delete confirmation, the worktree dialog). */}
            {showMenu && menu && (
              <div className="absolute right-0 top-full z-50 mt-1 w-44 rounded-md border border-ink/15 bg-paper py-1 text-xs shadow-lg">
                {menu}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
