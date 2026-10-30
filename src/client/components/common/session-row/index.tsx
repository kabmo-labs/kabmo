/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One session row for the `modern` sidebar style, at both densities.
 *
 * ONE component for the desktop list and the phone drawer, because the row is
 * the same decision in both places: which chat is this, is it running, does it
 * have a roster, and what can I do to it. The densities differ in touch target
 * and in how the trailing column reveals itself — `touch` has no hover, so the
 * age and the actions trigger are drawn side by side — and in nothing else.
 *
 * Three facts are shared with the shipped rows rather than re-derived, because
 * each one has a bug behind it:
 *
 * - the rename state comes from `useSessionRenaming`, so a rename started in
 *   either style (or on the phone) is visible here immediately;
 * - the action menu is `SessionActionsMenu` + `useRowMenu`, so a new action
 *   appears in every row everywhere;
 * - `data-testid="session-item"` and the row's accessible names are unchanged,
 *   so the browser specs address the same thing in both styles.
 *
 * ## The gutter is shared with the workspace header, numerically
 *
 * 4px of inset, the leading slot (16px; 18px on touch), then 8px before the
 * text; and on the trailing side a 22px (28px on touch) box ending 4px inside
 * the row's own edge — the same numbers `WorkspaceHeader` uses, so the status
 * glyph sits under the folder mark, the title under the folder name, and the two
 * `⋯` triggers share one column. `pl-1 pr-1`, not the `px-2` this row started
 * with: the header's own `px-1` is inside a container that starts at the list's
 * edge, and matching the row's padding to the header's is what makes the columns
 * line up.
 */

import type { TargetedMouseEvent } from 'preact';
import { useInlineRename } from '@/client/hooks/ui/inline-rename';
import { useSessionRenaming } from '@/client/hooks/workspace/renaming-sessions';
import { SessionActionsMenu, useRowMenu } from '@/client/components/common/session-actions-menu';
import { StatusSlot } from '@/client/components/common/session-row/StatusSlot';
import { TrailingSlot } from '@/client/components/common/session-row/TrailingSlot';
import { WorktreeBadge } from '@/client/components/layout/session-sidebar/WorktreeBadge';
import type { SessionWorktreeInfo } from '@/shared/lib/workspace/worktree/types';

export type SessionRowDensity = 'compact' | 'touch';

export interface SessionRowProps {
  sessionId: string | number;
  title: string;
  isActive?: boolean;
  isArchived?: boolean;
  status?: 'stream' | 'finish' | 'abort';
  awaitingInput?: boolean;
  timeAgo?: string | null;
  worktree?: SessionWorktreeInfo;
  /** The row's prompt is held until another session finishes. */
  waitingFor?: { title: string | null };
  hasSubagents?: boolean;
  isExpanded?: boolean;
  onToggleExpand?: (event: TargetedMouseEvent<HTMLElement>) => void;
  onClick?: () => void;
  onRename?: (name: string) => void;
  onRenameWithAi?: () => void;
  onArchive?: () => void;
  /** Omitted for a chat that cannot be deleted yet (a pending `new-…` row). */
  onDelete?: () => void;
  onCancelWait?: () => void;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  density?: SessionRowDensity;
}

export function SessionRow({
  sessionId,
  title,
  isActive = false,
  isArchived = false,
  status,
  awaitingInput = false,
  timeAgo,
  worktree,
  waitingFor,
  hasSubagents = false,
  isExpanded = false,
  onToggleExpand,
  onClick,
  onRename,
  onRenameWithAi,
  onArchive,
  onDelete,
  onCancelWait,
  selectable = false,
  selected = false,
  onToggleSelect,
  density = 'compact',
}: SessionRowProps) {
  const touch = density === 'touch';
  const renaming = useSessionRenaming(sessionId);
  const menu = useRowMenu();
  const {
    isEditing,
    draft,
    setDraft,
    inputRef,
    startRename,
    handleKeyDown,
    handleBlur,
  } = useInlineRename(title, onRename);
  const hasActions = Boolean(onRename || onArchive || onDelete || onCancelWait);
  const waiting = Boolean(waitingFor);
  const displayTitle = title.charAt(0).toUpperCase() + title.slice(1);

  if (isEditing) {
    return (
      <div className={`flex w-full items-center rounded-lg bg-ink/10 ${touch ? 'px-2 py-1.5' : 'px-2 py-1'}`}>
        <input
          ref={inputRef}
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          aria-label="Session name"
          className="min-w-0 flex-1 rounded border border-ink/25 bg-paper px-2 py-0.5 text-xs text-ink outline-none focus:border-ink/50"
        />
      </div>
    );
  }

  return (
    <>
      <div
        data-testid="session-item"
        data-session-id={String(sessionId)}
        data-selected={selectable && selected ? 'true' : undefined}
        onClick={selectable ? onToggleSelect : onClick}
        onContextMenu={hasActions && !selectable ? menu.openAtCursor : undefined}
        className={`group/item relative flex w-full items-center rounded-lg text-xs transition-colors select-none cursor-pointer ${
          touch ? 'py-2.5 pl-1 pr-1' : 'py-[7px] pl-1 pr-1'
        } ${
          selectable && selected
            ? 'bg-ink/10 text-ink ring-1 ring-inset ring-ink/20'
            : isActive
              ? 'bg-ink/[0.08] font-medium text-ink'
              : 'text-ink/75 hover:bg-ink/[0.04] hover:text-ink'
        }`}
      >
        {/* The active marker is a POSITION cue, not a tint: a 2px bar survives a
            palette where `bg-ink/10` is nearly invisible, and it survives being
            read by someone who cannot separate two low-contrast greys. */}
        {isActive && !selectable && (
          <span aria-hidden="true" className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-ink" />
        )}

        <StatusSlot
          title={title}
          status={status}
          awaitingInput={awaitingInput}
          renaming={renaming}
          waitingFor={waitingFor}
          expandable={hasSubagents}
          isExpanded={isExpanded}
          onToggleExpand={onToggleExpand}
          selectable={selectable}
          selected={selected}
          onToggleSelect={onToggleSelect}
          touch={touch}
        />

        <span className={`flex min-w-0 flex-1 flex-col leading-snug ${isArchived ? 'text-ink/45' : ''}`}>
          <span className="truncate">{displayTitle}</span>
          {waiting && (
            <span className="truncate text-[10px] font-normal text-ink/40">
              waiting for {waitingFor?.title ?? 'another session'}
            </span>
          )}
          {worktree && <WorktreeBadge worktree={worktree} />}
        </span>

        <TrailingSlot
          timeAgo={timeAgo}
          touch={touch}
          menuOpen={menu.anchor !== null}
          onOpenMenu={hasActions && !selectable ? menu.openBelow : undefined}
        />
      </div>

      {menu.anchor && (
        <SessionActionsMenu
          anchor={menu.anchor}
          isArchived={isArchived}
          onRename={onRename ? startRename : undefined}
          onRenameWithAi={onRenameWithAi}
          onArchive={onArchive}
          onDelete={onDelete}
          onCancelWait={onCancelWait}
          onClose={menu.close}
        />
      )}
    </>
  );
}
