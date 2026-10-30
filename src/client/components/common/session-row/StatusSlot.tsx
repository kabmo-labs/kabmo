/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The 16px leading slot of a session row, in the `modern` style.
 *
 * One slot owns every glyph — never two side by side — which is the rule both
 * shipped rows already follow and the reason a running session does not push
 * its title sideways. The order of precedence is unchanged, because each rung
 * is a bug the previous one fixed:
 *
 *   1. an in-flight rename — it answers a click that is still pending;
 *   2. blocked on a question — says it is YOUR turn, not that work is happening;
 *   3. a held prompt — the row exists only because a prompt is waiting;
 *   4. a run in flight — the spinner;
 *   5. the roster chevron, PINNED while the row has subagents.
 *
 * A batch checkbox replaces the whole slot: in that mode the row is a choice,
 * and a run spinner beside a checkbox reads as a second, unrelated control.
 */

import type { TargetedMouseEvent } from 'preact';
import { Check, ChevronDown, ChevronRight, CircleQuestionMark, Hourglass, Loader2 } from 'lucide-preact';
import { SelectionCheckbox } from '@/client/components/common/batch-selection/SelectionCheckbox';

export interface StatusSlotProps {
  title: string;
  status?: 'stream' | 'finish' | 'abort';
  awaitingInput?: boolean;
  renaming?: boolean;
  waitingFor?: { title: string | null };
  /** The row has a subagent roster, so the chevron exists. */
  expandable?: boolean;
  isExpanded?: boolean;
  onToggleExpand?: (event: TargetedMouseEvent<HTMLElement>) => void;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  /** Larger glyphs for a touch row. */
  touch?: boolean;
}

export function StatusSlot({
  title,
  status,
  awaitingInput = false,
  renaming = false,
  waitingFor,
  expandable = false,
  isExpanded = false,
  onToggleExpand,
  selectable = false,
  selected = false,
  onToggleSelect,
  touch = false,
}: StatusSlotProps) {
  if (selectable) {
    return (
      <span className="flex shrink-0 items-center">
        <SelectionCheckbox
          checked={selected}
          label={`Select ${title}`}
          onChange={() => onToggleSelect?.()}
        />
        <span className="w-2 shrink-0" />
      </span>
    );
  }

  const size = touch ? 14 : 13;
  const waiting = Boolean(waitingFor);
  const liveRun = awaitingInput || status === 'stream' || waiting;
  const chevronPinned = Boolean(expandable && onToggleExpand) && !liveRun && !renaming;
  // `waiting` belongs in this list on its own: a held prompt is a pending
  // `new-…` chat, which has no transcript and therefore no `status` — without it
  // the one cue saying the row exists at all was never drawn.
  const showStatus = Boolean(renaming || awaitingInput || waiting || status) && !chevronPinned;

  return (
    <>
      <span className={`relative shrink-0 ${touch ? 'w-[18px] h-5' : 'w-4 h-4'}`}>
        {expandable && onToggleExpand && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onToggleExpand(event);
            }}
            title={isExpanded ? 'Collapse subagents' : 'Expand subagents'}
            aria-expanded={isExpanded}
            aria-label={isExpanded ? 'Collapse subagents' : 'Expand subagents'}
            className={`peer absolute inset-0 flex items-center justify-center rounded cursor-pointer transition-opacity ${
              chevronPinned
                ? 'text-ink/55 hover:text-ink'
                : 'text-ink/40 opacity-0 hover:text-ink group-hover/item:opacity-100 focus-visible:opacity-100'
            }`}
          >
            {isExpanded ? <ChevronDown size={size} /> : <ChevronRight size={size} />}
          </button>
        )}

        {showStatus && (
          <span
            className={`pointer-events-none absolute inset-0 flex items-center justify-center text-ink/60 transition-opacity ${
              expandable ? 'group-hover/item:opacity-0 peer-focus-visible:opacity-0' : ''
            }`}
          >
            {renaming ? (
              <span role="status" aria-label="Generating a name…">
                <Loader2 size={size - 1} className="animate-spin" />
              </span>
            ) : awaitingInput ? (
              <CircleQuestionMark size={size - 1} className="animate-pulse text-warning" />
            ) : waiting ? (
              <span role="status" aria-label={`Waiting for ${waitingFor?.title ?? 'another session'}`}>
                <Hourglass size={size - 1} className="animate-pulse" />
              </span>
            ) : status === 'stream' ? (
              <span role="status" aria-label="Running">
                <Loader2 size={size - 1} className="animate-spin" />
              </span>
            ) : (
              <Check size={size - 1} />
            )}
          </span>
        )}
      </span>
      <span className="w-2 shrink-0" />
    </>
  );
}
