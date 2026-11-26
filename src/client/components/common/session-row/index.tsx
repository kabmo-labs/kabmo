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
 * text; and on the trailing side a 22px (28px on touch) box — the same numbers
 * `WorkspaceHeader` uses, so the status glyph sits under the folder mark, the
 * title under the folder name, and the two `⋯` triggers share one column.
 *
 * The right inset is 3px (4px on touch), which is exactly half the difference
 * between the trailing box and the chrome control it lines up with. The action
 * row's sort trigger is a 28px box (36px on touch); a row's `⋯` box is 22px
 * (28px). The list's content edge is the action row's content edge (see
 * `.session-list-gutter`), so centring the narrower box needs only that half
 * difference — the reported "titik tiga tidak lurus dengan sort". The age keeps
 * its 4px inset inside the box, which is the glyph's own inset, so at rest the
 * age ends on the sort icon's right edge and on hover the dots take its place
 * on that line. `WorkspaceHeader` states the same inset; the row and the header
 * move together.
 *
 * ## The touch row is exactly as tall as the folder header
 *
 * `h-8` — 32px — is the workspace header's height on touch (`WorkspaceHeader`),
 * and the rows under it must match it or the list reads as two rhythms: a thin
 * name over tall items. The row's own height is driven by its tallest child,
 * the 28px trailing action box (`p-1.5` + a 16px glyph, see `TrailingSlot`), so
 * 2px of vertical padding lands on 32px. `py-0.5`, not a fixed `h-8`: a row that
 * carries a second line (a held prompt, a worktree badge) has to grow, and a
 * fixed height would clip it.
 */

import type { TargetedMouseEvent } from 'preact';
import { useInlineRename } from '@/client/hooks/ui/inline-rename';
import { useSessionRenaming } from '@/client/hooks/workspace/renaming-sessions';
import { SessionActionsMenu, useRowMenu } from '@/client/components/common/session-actions-menu';
import { StatusSlot } from '@/client/components/common/session-row/StatusSlot';
import { HarnessGlyph, HARNESS_GLYPH_SIZE } from '@/client/components/common/harness-glyph';
import type { BranchRowStyle } from '@/client/components/common/session-branch/style';
import { TrailingSlot } from '@/client/components/common/session-row/TrailingSlot';
import { SESSION_ROW_ATTENTION_CLASS } from '@/client/components/common/session-row/row-state';
import { WorktreeBadge } from '@/client/components/layout/session-sidebar/WorktreeBadge';
import type { SessionWorktreeInfo } from '@kabmo-labs/kabmo-worktree/types';

export type SessionRowDensity = 'compact' | 'touch';

/** What a subagent row under this chrome's rows borrows from it. */
export function sessionRowBranchStyle(touch: boolean): BranchRowStyle {
  return {
    inset: touch ? 'pl-1 pr-1' : 'pl-1 pr-[3px]',
    insetPx: 4,
    slotWidth: touch ? 18 : 16,
    markGap: 8,
    padding: touch ? 'py-0.5' : 'py-[7px]',
    glyph: touch ? HARNESS_GLYPH_SIZE.touch : HARNESS_GLYPH_SIZE.compact,
  };
}

export interface SessionRowProps {
  sessionId: string | number;
  title: string;
  /** Harness that ran this session (`omp-rpc`, `claude`, …). Absent draws no
   *  glyph, so a pre-harness row keeps its old alignment. */
  harness?: string;
  isActive?: boolean;
  isArchived?: boolean;
  status?: 'stream' | 'finish' | 'abort';
  awaitingInput?: boolean;
  timeAgo?: string | null;
  /** Full timestamp shown as the age's hover tooltip. */
  timeTitle?: string | null;
  /** Epoch ms this row's live run started; the timestamp slot counts instead
   *  of showing the age. Absent for a settled row. */
  runStartedAt?: number;
  worktree?: SessionWorktreeInfo;
  /** The row's prompt is held until another session finishes. */
  waitingFor?: { title: string | null };
  /** Whether this row can expand its branch (child sessions and subagents). */
  expandable?: boolean;
  isExpanded?: boolean;
  onToggleExpand?: (event: TargetedMouseEvent<HTMLElement>) => void;
  /** Drawn inside a parent's branch; a leaf child gets a child mark in its slot. */
  isChild?: boolean;
  /** The folder the row belongs to, so a child spawned from its menu lands in
   *  the right list before the server answers. */
  folderId?: number | string;
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
  harness,
  isActive = false,
  isArchived = false,
  status,
  awaitingInput = false,
  timeAgo,
  timeTitle,
  runStartedAt,
  worktree,
  waitingFor,
  expandable = false,
  isExpanded = false,
  onToggleExpand,
  isChild = false,
  folderId,
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
  const menuOpen = menu.anchor !== null;
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
        data-menu-open={menuOpen ? 'true' : undefined}
        onClick={selectable ? onToggleSelect : onClick}
        onContextMenu={hasActions && !selectable ? menu.openAtCursor : undefined}
        className={`group/item relative flex w-full items-center rounded-lg text-xs transition-colors select-none cursor-pointer ${
          touch ? 'py-0.5 pl-1 pr-1' : 'py-[7px] pl-1 pr-[3px]'
        } ${
          (selectable && selected) || menuOpen
            ? SESSION_ROW_ATTENTION_CLASS
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
          expandable={expandable}
          isExpanded={isExpanded}
          onToggleExpand={onToggleExpand}
          child={isChild}
          selectable={selectable}
          selected={selected}
          onToggleSelect={onToggleSelect}
          touch={touch}
        />

        {/* The harness mark sits BETWEEN the leading slot and the name — the
            same order and size as the classic row (`SessionItem`): the leading
            slot owns the run cue, the mark answers "which agent wrote this?",
            and the name follows. Gated at the call site, because `HarnessGlyph`
            returns null and would leave its 6px gap behind on a row that has no
            harness (pre-harness and MOCK rows). */}
        {harness && (
          <span className="mr-1.5 flex shrink-0 items-center">
            <HarnessGlyph harness={harness} size={touch ? HARNESS_GLYPH_SIZE.touch : HARNESS_GLYPH_SIZE.compact} />
          </span>
        )}

        <span className={`flex min-w-0 flex-1 flex-col leading-snug ${isArchived ? 'text-ink/45' : ''}`}>
          <span className="min-w-0 truncate">{displayTitle}</span>
          {waiting && (
            <span className="truncate text-[10px] font-normal text-ink/40">
              waiting for {waitingFor?.title ?? 'another session'}
            </span>
          )}
          {worktree && <WorktreeBadge worktree={worktree} />}
        </span>

        <TrailingSlot
          timeAgo={timeAgo}
          timeTitle={timeTitle}
          runStartedAt={runStartedAt}
          touch={touch}
          menuOpen={menuOpen}
          onOpenMenu={hasActions && !selectable ? menu.openBelow : undefined}
        />
      </div>

      {menu.anchor && (
        <SessionActionsMenu
          anchor={menu.anchor}
          sessionId={sessionId}
          {...(harness ? { harness } : {})}
          {...(folderId !== undefined ? { folderId } : {})}
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
