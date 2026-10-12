import { Check, ChevronDown, ChevronRight, CircleQuestionMark, Loader2, MoreHorizontal } from 'lucide-preact';
import type { SessionItemData } from '@/shared/types';
import { useInlineRename } from '@/client/hooks/ui/inline-rename';
import { useSessionRenaming } from '@/client/hooks/workspace/renaming-sessions';
import { SessionActionsMenu, useRowMenu } from '@/client/components/common/session-actions-menu';

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
  const hasActions = Boolean(onRename || onArchive || onDelete);

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
        onContextMenu={hasActions ? menu.openAtCursor : undefined}
        className={`w-full rounded-lg flex items-center transition-colors ${
          isActive ? 'bg-ink/10 font-medium text-ink' : 'hover:bg-ink/5 text-ink/85'
        }`}
      >
        <button
          type="button"
          onClick={onSelect}
          className="flex-1 text-left pl-2 pr-3 py-2 flex items-center justify-between min-w-0"
        >
          <div className="flex items-center min-w-0 pr-2">
            {/* Status slot, 16px at the same x as the folder header's icon slot,
                so the left column reads as one line. Waiting on an answer
                outranks the run spinner — the spinner says work is happening,
                the question mark says it is YOUR turn (desktop parity). An
                in-flight rename outranks both, for the same reason it does
                there: it answers a click that is still pending. */}
            <span className="w-4 flex-shrink-0 flex items-center justify-center">
              {renaming ? (
                <span role="status" aria-label="Generating a name…">
                  <Loader2 size={13} className="text-ink/50 animate-spin" />
                </span>
              ) : awaitingInput ? (
                <CircleQuestionMark size={13} className="text-ink/70 animate-pulse" />
              ) : status === 'stream' ? (
                <Loader2 size={13} className="text-ink/50 animate-spin" />
              ) : status ? (
                <Check size={13} className="text-ink/50" />
              ) : null}
            </span>
            <span className="text-xs truncate leading-snug ml-2">{title}</span>
          </div>

          <span className="text-[11px] text-ink/45 font-mono flex-shrink-0 ml-2">{timeAgo ?? ''}</span>
        </button>

        {/* One trigger for rename / archive / delete, always visible: a touch
            surface has no hover, and the always-on action buttons this replaced
            consumed a third of a phone's row width.
            `mr-1` only when the row has NO roster toggle — it reserves that
            column so the trailing glyph's centre stays 19px from the row's right
            edge whether the last element is this trigger or the chevron. Without
            it the glyphs step in and out from row to row. */}
        {hasActions && (
          <button
            type="button"
            onClick={menu.openBelow}
            title="Session actions"
            aria-label="Session actions"
            aria-haspopup="menu"
            aria-expanded={menu.anchor !== null}
            className={`flex-shrink-0 p-2 text-ink/35 hover:text-ink rounded-lg cursor-pointer ${showChevron ? '' : 'mr-1'}`}
          >
            <MoreHorizontal size={16} />
          </button>
        )}

        {/* Last element, so its glyph sits in the folder header's chevron column.
            `p-1.5 mr-1.5` centres a 14px glyph on that column while keeping a
            touch-sized tap target. */}
        {showChevron && (
          <button
            type="button"
            onClick={onToggleExpand}
            title={isExpanded ? 'Collapse subagents' : 'Expand subagents'}
            aria-expanded={isExpanded}
            aria-label={isExpanded ? 'Collapse subagents' : 'Expand subagents'}
            className="flex-shrink-0 p-1.5 mr-1.5 flex items-center justify-center text-ink/50 hover:text-ink rounded-lg cursor-pointer"
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
          onClose={menu.close}
        />
      )}
    </>
  );
}
