import type { TargetedMouseEvent } from 'preact';
import { Check, ChevronDown, ChevronRight, CircleQuestionMark, Hourglass, Loader2, MoreHorizontal } from 'lucide-preact';
import { useInlineRename } from '@/client/hooks/ui/inline-rename';
import { useSessionRenaming } from '@/client/hooks/workspace/renaming-sessions';
import { SessionActionsMenu, useRowMenu } from '@/client/components/common/session-actions-menu';
import { SelectionCheckbox } from '@/client/components/common/batch-selection/SelectionCheckbox';

export interface SessionItemProps {
  /** The session this row draws; the key its in-flight rename is tracked under. */
  sessionId: string | number;
  title: string;
  isActive?: boolean;
  isArchived?: boolean;
  status?: 'stream' | 'finish' | 'abort';
  /** The session's agent is blocked on a question until the user answers it. */
  awaitingInput?: boolean;
  /** Relative age of the session, or null when no usable timestamp exists.
   *  Same column the phone's row carries, from the same helper. */
  timeAgo?: string | null;
  onClick?: () => void;
  onArchive?: () => void;
  /** Omitted for a session that cannot be deleted yet (a pending `new-…` chat,
   *  which has no transcript anywhere). */
  onDelete?: () => void;
  onRename?: (name: string) => void;
  /** Ask omp to name this session from its transcript. Omitted for a pending
   *  `new-…` chat, which has no transcript to derive a title from. */
  onRenameWithAi?: () => void;
  expandable?: boolean;
  isExpanded?: boolean;
  hasSubagents?: boolean;
  onToggleExpand?: (e: TargetedMouseEvent<HTMLElement>) => void;
  /**
   * The row's prompt is held until another session finishes. A pending row has
   * no transcript and no omp id, so this cue is the only thing on screen saying
   * the chat exists and what it is waiting for.
   */
  waitingFor?: { title: string | null };
  /** Drop this row's held prompt, from the row's own menu. */
  onCancelWait?: () => void;
  /** Draw a checkbox and let the row's click toggle the selection instead of
   *  opening the session (batch mode). */
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}

export function SessionItem({
  sessionId,
  title,
  isActive = false,
  isArchived = false,
  status,
  awaitingInput = false,
  timeAgo,
  onClick,
  onArchive,
  onDelete,
  onRename,
  onRenameWithAi,
  expandable = false,
  isExpanded = false,
  hasSubagents = false,
  onToggleExpand,
  waitingFor,
  onCancelWait,
  selectable = false,
  selected = false,
  onToggleSelect,
}: SessionItemProps) {
  // A rename in flight is drawn in the same 16px slot the run spinner uses, so
  // a row the user just acted on says so where they are already looking. It
  // outranks the run cue: the server refuses a rename mid-run, so the two can
  // only overlap for the instant the refusal is in flight.
  const renaming = useSessionRenaming(sessionId);
  const showChevron = Boolean(expandable && hasSubagents && onToggleExpand);
  // The slot shows one glyph, never two side by side. A live run signal owns
  // it at rest — the spinner, or the blocked-on-a-question cue, which says it
  // is YOUR turn. With nothing live to report the chevron is PINNED, collapsed
  // or expanded: it is the only affordance left worth showing, and making it
  // hover-only would leave the roster reachable only by hovering exactly the
  // right 16px.
  const waiting = Boolean(waitingFor);
  const liveRun = awaitingInput || status === 'stream' || waiting;
  const chevronPinned = showChevron && !liveRun && !renaming;
  const showStatus = Boolean(renaming || awaitingInput || status) && !chevronPinned;
  const {
    isEditing,
    draft,
    setDraft,
    inputRef,
    startRename,
    handleKeyDown,
    handleBlur,
  } = useInlineRename(title, onRename);
  // One trigger for every row action; also reachable by right-clicking the row.
  const menu = useRowMenu();
  const hasActions = Boolean(onRename || onArchive || onDelete || onCancelWait);

  return (
    <>
      <div
        data-testid="session-item"
        data-session-id={String(sessionId)}
        data-selected={selectable && selected ? 'true' : undefined}
        onClick={isEditing ? undefined : selectable ? onToggleSelect : onClick}
        onContextMenu={hasActions && !isEditing && !selectable ? menu.openAtCursor : undefined}
        className={`group/item relative flex items-center w-full rounded-lg px-2 py-1.5 cursor-pointer text-xs transition-colors select-none ${
          selectable && selected
            ? 'bg-ink/10 text-ink ring-1 ring-inset ring-ink/20'
            : isActive
              ? 'bg-ink/10 font-medium text-ink'
              : 'text-ink/75 hover:text-ink hover:bg-ink/5'
        }`}
      >
        {/* The checkbox takes the row's leading slot in batch mode. It replaces
            the status/chevron column rather than sitting beside it: a row in
            this mode is a choice, and a run spinner next to a checkbox reads as
            a second, unrelated control. */}
        {selectable ? (
          <>
            <SelectionCheckbox
              checked={selected}
              label={`Select ${title}`}
              onChange={() => onToggleSelect?.()}
            />
            <span className="w-2 shrink-0" />
          </>
        ) : (
          <>
        {/* One 16px slot owns both icons — never two side by side. A live run
            signal (blocked question, run spinner) holds the slot; otherwise the
            chevron is pinned, collapsed or expanded. While the signal holds it,
            hovering hands the slot to the chevron so the roster stays reachable
            mid-run.
            Both layers are pointer-inert for the opposite state: the toggle
            while hidden, the status glyph ALWAYS (it is painted after the
            toggle, so without that it wins the hit test over the revealed
            chevron and every click on a badged row selects the session instead
            of expanding it). */}
        <span className="relative w-4 h-4 shrink-0">
          {showChevron && onToggleExpand && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpand(e);
              }}
              title={isExpanded ? 'Collapse subagents' : 'Expand subagents'}
              aria-expanded={isExpanded}
              className={`peer absolute inset-0 flex items-center justify-center rounded cursor-pointer transition-opacity ${
                chevronPinned
                  ? 'text-ink/60 hover:text-ink'
                  : 'text-ink/40 hover:text-ink pointer-events-none opacity-0 group-hover/item:pointer-events-auto group-hover/item:opacity-100 focus-visible:opacity-100'
              }`}
            >
              {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>
          )}
          {showStatus && (
            <span
              className={`pointer-events-none absolute inset-0 flex items-center justify-center text-ink/60 transition-opacity ${
                showChevron ? 'group-hover/item:opacity-0 peer-focus-visible:opacity-0' : ''
              }`}
            >
              {/* Waiting on an answer outranks the run spinner: the spinner says
                  work is happening, the question mark says it is YOUR turn.
                  An in-flight rename outranks both — it is the answer to the
                  click that is still pending, and it names itself in `title`
                  so the glyph is not a second unexplained spinner. */}
              {renaming ? (
                <span role="status" aria-label="Generating a name…">
                  <Loader2 size={12} className="animate-spin" />
                </span>
              ) : awaitingInput ? (
                <CircleQuestionMark size={12} className="animate-pulse text-ink/80" />
              ) : waiting ? (
                <span role="status" aria-label={`Waiting for ${waitingFor?.title ?? 'another session'}`}>
                  <Hourglass size={12} className="animate-pulse text-ink/60" />
                </span>
              ) : status === 'stream' ? (
                // The run spinner is the ONE thing on this row that says a run
                // is in flight, and it was an unlabelled icon: a screen reader
                // got a bare `svg`, and nothing could ask "is this session
                // running" by name. The rename and waiting cues beside it were
                // already labelled, so this was the one status a reader — or an
                // assertion — had to identify by shape.
                <span role="status" aria-label="Running">
                  <Loader2 size={12} className="animate-spin" />
                </span>
              ) : (
                <Check size={12} />
              )}
            </span>
          )}
        </span>

        {/* Gap between icon and text */}
        <span className="w-2 shrink-0" />
          </>
        )}

        {/* Session Title - aligned straight with Folder Name */}
        {isEditing ? (
          <input
            ref={inputRef}
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.currentTarget.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            className="flex-1 min-w-0 bg-paper border border-ink/25 rounded px-1 py-0.5 text-xs text-ink outline-none focus:border-ink/50"
          />
        ) : (
          <span className="flex-1 min-w-0 flex flex-col leading-snug">
            <span className="truncate">
              {title.charAt(0).toUpperCase() + title.slice(1)}
            </span>
            {/* One muted line under the title: the row is a real chat, and this
                is why it has not started yet. */}
            {waiting && (
              <span className="truncate text-[10px] text-ink/40 font-normal">
                waiting for {waitingFor?.title ?? 'another session'}
              </span>
            )}
          </span>
        )}

        {/* Same trailing column the phone draws, from the same helper — the
            row's age is what tells two identically-titled chats apart. */}
        {!isEditing && timeAgo && (
          <span className="shrink-0 ml-2 font-mono text-[10px] text-ink/40">{timeAgo}</span>
        )}

        {/* One trigger, whatever the row can do — the menu grows, so a row with
            more actions costs no extra width. It is always drawn, the way the
            phone's row draws it: a hover-only trigger is invisible until the
            pointer happens to find the right 22px, and the row it belongs to
            gives no hint it is there. A right-click anywhere on the row opens
            the same menu.
            `ml-1` on top of the button's own `p-1` is the same 8px the title
            keeps from the time column, so the row's two gaps read as one
            rhythm instead of the glyph crowding the age. */}
        {!isEditing && hasActions && !selectable && (
          <button
            type="button"
            onClick={menu.openBelow}
            title="Session actions"
            aria-label="Session actions"
            aria-haspopup="menu"
            aria-expanded={menu.anchor !== null}
            className="shrink-0 ml-1 p-1 text-ink/40 hover:text-ink hover:bg-ink/10 rounded cursor-pointer"
          >
            <MoreHorizontal size={14} />
          </button>
        )}

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
