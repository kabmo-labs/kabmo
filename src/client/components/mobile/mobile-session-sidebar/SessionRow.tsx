import { Check, ChevronDown, ChevronRight, CircleQuestionMark, Hourglass, Loader2, MoreHorizontal } from 'lucide-preact';
import type { SessionItemData } from '@/shared/types';
import { useInlineRename } from '@/client/hooks/ui/inline-rename';
import { useSessionRenaming } from '@/client/hooks/workspace/renaming-sessions';
import { SessionActionsMenu, useRowMenu } from '@/client/components/common/session-actions-menu';
import { SelectionCheckbox } from '@/client/components/common/batch-selection/SelectionCheckbox';

export interface MobileSessionRowProps {
  session: SessionItemData;
  isActive: boolean;
  status?: 'stream' | 'finish' | 'abort';
  /** The session's agent is blocked on a question until the user answers it. */
  awaitingInput?: boolean;
  /** Relative age of the session, or null when no usable timestamp exists. */
  timeAgo: string | null;
  /** The session has a subagent roster (on disk or live), so it can be expanded. */
  hasSubagents?: boolean;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  onSelect: () => void;
  onArchive: () => void;
  /** Omitted for a session that cannot be deleted yet (a pending `new-…` chat,
   *  which has no transcript anywhere). */
  onDelete?: () => void;
  onRename?: (name: string) => void;
  /** Ask omp to name this session from its transcript. Omitted for a pending
   *  `new-…` chat, which has no transcript to derive a title from. */
  onRenameWithAi?: () => void;
  /** Draw a checkbox and let the row's tap toggle the selection instead of
   *  opening the session (batch mode). */
  /** The row's prompt is held until another session finishes (see the desktop
   *  row's `waitingFor`: a pending chat has nothing else to show). */
  waitingFor?: { title: string | null };
  /** Drop this row's held prompt, from the row's own menu. */
  onCancelWait?: () => void;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}

export function MobileSessionRow({
  session,
  isActive,
  status,
  awaitingInput = false,
  timeAgo,
  hasSubagents = false,
  isExpanded = false,
  onToggleExpand,
  onSelect,
  onArchive,
  onDelete,
  onRename,
  onRenameWithAi,
  waitingFor,
  onCancelWait,
  selectable = false,
  selected = false,
  onToggleSelect,
}: MobileSessionRowProps) {
  const {
    isEditing,
    draft,
    setDraft,
    inputRef,
    startRename,
    handleKeyDown,
    handleBlur,
  } = useInlineRename(session.title, onRename);
  // The phone draws the same cue the desktop row does, from the same store, so
  // a rename started in either layout is visible in both.
  const renaming = useSessionRenaming(session.id);
  // One trigger for every row action; also reachable by long-press contextmenu.
  const menu = useRowMenu();
  const hasActions = Boolean(onRename || onArchive || onDelete || onCancelWait);
  const waiting = Boolean(waitingFor);

  // The roster toggle is the row's LAST element, so its glyph lands in the same
  // column as the folder header's expand chevron — one vertical line of
  // disclosure controls down the drawer. The toggle is a SIBLING of the select
  // button, never a child: a button inside a button is invalid and the browser
  // reparents it.
  //
  // Touch has no hover to reveal a hidden toggle the way desktop does, so it is
  // pinned whenever the row has a roster; a hidden one would leave the roster
  // unreachable on a phone.
  const showChevron = hasSubagents && Boolean(onToggleExpand);
  const title = session.title.charAt(0).toUpperCase() + session.title.slice(1);

  if (isEditing) {
    return (
      <div className="w-full rounded-lg flex items-center bg-ink/10">
        <input
          ref={inputRef}
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          className="flex-1 min-w-0 mx-2 my-1.5 bg-paper border border-ink/25 rounded px-2 py-1 text-xs text-ink outline-none focus:border-ink/50"
        />
      </div>
    );
  }

  return (
    <>
      <div
        data-testid="session-item"
        data-session-id={String(session.id)}
        onContextMenu={hasActions && !selectable ? menu.openAtCursor : undefined}
        // The tint covers the WHOLE row — the `⋯` included. It is the row that
        // is active, not the part of it left over after the triggers, and a
        // block that stopped short of the trigger read as a half-painted
        // selection.
        //
        // The gap between the trigger's ink and the block's rounded corner is
        // `pr-1.5` INSIDE the trigger (see below), never padding on this row:
        // a row inset would shrink the tint and pull every trailing glyph 6px
        // left of the folder header's chevron.
        className={`w-full rounded-lg flex items-center transition-colors ${
          selectable && selected
            ? 'bg-ink/10 ring-1 ring-inset ring-ink/20 text-ink'
            : isActive ? 'bg-ink/10 font-medium text-ink' : 'hover:bg-ink/5 text-ink/85'
        }`}
      >
        <button
          type="button"
          onClick={selectable ? onToggleSelect : onSelect}
          className="flex-1 text-left py-2 flex items-center justify-between min-w-0"
        >
          <div className="flex items-center min-w-0 pr-2">
            {/* Status slot, 16px at the same x as the folder header's icon slot,
                so the left column reads as one line. Waiting on an answer
                outranks the run spinner — the spinner says work is happening,
                the question mark says it is YOUR turn (desktop parity). An
                in-flight rename outranks both, for the same reason it does
                there: it answers a click that is still pending.
                In batch mode the slot carries the checkbox instead: a row that
                is a choice should not also report a run. */}
            {selectable ? (
              <SelectionCheckbox
                checked={selected}
                label={`Select ${session.title}`}
                onChange={() => onToggleSelect?.()}
              />
            ) : (
            <span className="w-4 flex-shrink-0 flex items-center justify-center">
              {renaming ? (
                <span role="status" aria-label="Generating a name…">
                  <Loader2 size={13} className="text-ink/50 animate-spin" />
                </span>
              ) : awaitingInput ? (
                <CircleQuestionMark size={13} className="text-ink/70 animate-pulse" />
              ) : waiting ? (
                <span role="status" aria-label={`Waiting for ${waitingFor?.title ?? 'another session'}`}>
                  <Hourglass size={13} className="text-ink/60 animate-pulse" />
                </span>
              ) : status === 'stream' ? (
                // Same label the desktop row carries, for the same reason: the
                // phone draws the identical cue, and an unlabelled spinner is
                // both unreachable to a screen reader and unassertable.
                <span role="status" aria-label="Running">
                  <Loader2 size={13} className="text-ink/50 animate-spin" />
                </span>
              ) : status ? (
                <Check size={13} className="text-ink/50" />
              ) : null}
            </span>
            )}
            <span className="flex flex-col min-w-0 ml-2 leading-snug">
              <span className="text-xs truncate">{title}</span>
              {waiting && (
                <span className="text-[10px] text-ink/40 truncate">
                  waiting for {waitingFor?.title ?? 'another session'}
                </span>
              )}
            </span>
          </div>

          <span className="text-[11px] text-ink/45 font-mono flex-shrink-0 ml-2">{timeAgo ?? ''}</span>
        </button>

        {/* One trigger for rename / archive / delete, always visible: a touch
            surface has no hover, and the always-on action buttons this replaced
            consumed a third of a phone's row width.
            `pl-1.5 pr-1`: the BOX still ends on the row's trailing edge (so its
            right edge matches the folder header's chevron and the toolbar's
            last control), while the glyph's ink sits 4px inside it — clear of
            the tinted block's rounded corner without shrinking that block. */}
        {hasActions && !selectable && (
          <button
            type="button"
            onClick={menu.openBelow}
            title="Session actions"
            aria-label="Session actions"
            aria-haspopup="menu"
            aria-expanded={menu.anchor !== null}
            className="flex-shrink-0 py-1.5 pl-1.5 pr-1 text-ink/35 hover:text-ink rounded-lg cursor-pointer"
          >
            <MoreHorizontal size={16} />
          </button>
        )}

        {/* Last element, so its glyph shares the trigger's column — the same
            inset pair and the same 4px ink margin. */}
        {showChevron && !selectable && (
          <button
            type="button"
            onClick={onToggleExpand}
            title={isExpanded ? 'Collapse subagents' : 'Expand subagents'}
            aria-expanded={isExpanded}
            aria-label={isExpanded ? 'Collapse subagents' : 'Expand subagents'}
            className="flex-shrink-0 py-1.5 pl-1.5 pr-1 flex items-center justify-center text-ink/50 hover:text-ink rounded-lg cursor-pointer"
          >
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        )}
      </div>

      {menu.anchor && (
        <SessionActionsMenu
          anchor={menu.anchor}
          isArchived={session.is_archived === 1}
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
