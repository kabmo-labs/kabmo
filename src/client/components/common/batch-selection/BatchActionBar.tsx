/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The bar a batch selection raises: what is selected, select-all / unselect-all,
 * Archive (session mode only), Delete and Cancel.
 *
 * It sits at the bottom of the sidebar (desktop) or above the list (phone) and
 * is the ONLY place a destructive action can be started — the checkboxes
 * themselves never act, so a mis-tap on a row cannot delete anything. Select-all
 * and unselect-all are two buttons rather than one toggle: after a partial
 * selection the user needs both directions, and one alternating control cannot
 * say which it means.
 *
 * The scope noun is the mode's, not the bar's: "Select all" on the session mode
 * means every session of the workspace whose menu started it, and on the
 * workspace mode every workspace on screen.
 *
 * Archive is a SESSION verb — a workspace has no archive state — so the caller
 * passes `onArchive` only in session mode, and the bar omits the control when it
 * is absent. The action row is a grid: three columns when Archive is absent
 * (Select all / Unselect all / Delete) and two when it is present, so the four
 * labels stay readable in a 264px sidebar instead of truncating to nothing.
 */

import { Archive, CheckCheck, Loader2, Trash2, X } from 'lucide-preact';
import type { BatchMode } from '@/shared/lib/workspace/batch-select';

export interface BatchActionBarProps {
  mode: BatchMode;
  /** How many rows are selected. */
  count: number;
  /** How many the scope can offer — the denominator of "3 of 12". */
  total: number;
  /** True while a batch delete is in flight. */
  busy: boolean;
  /** True while a batch archive is in flight. */
  archiving?: boolean;
  /** The scope's name, for the sentence ("in kabmo"). Omitted in workspace mode. */
  scopeLabel?: string;
  onSelectAll: () => void;
  onUnselectAll: () => void;
  onDelete: () => void;
  /** Present only in session mode; the bar draws Archive when it is. */
  onArchive?: () => void;
  onCancel: () => void;
  /**
   * The bar sits in the phone drawer, whose list and toolbar are both `p-3`.
   * The desktop sidebar's list is `p-2`, so its bar keeps the tighter inset —
   * one shared value would leave the phone's bar 2px inside the rows it counts.
   */
  drawer?: boolean;
}

export function BatchActionBar({
  mode,
  count,
  total,
  busy,
  archiving = false,
  scopeLabel,
  onSelectAll,
  onUnselectAll,
  onDelete,
  onArchive,
  onCancel,
  drawer = false,
}: BatchActionBarProps) {
  const noun = mode === 'workspace' ? 'workspace' : 'session';
  const plural = count === 1 ? noun : `${noun}s`;
  const where = mode === 'session' && scopeLabel ? ` in ${scopeLabel}` : '';
  // Any mutation in flight locks the whole bar: a second click while the first
  // request is unresolved would act on a selection the server is already
  // changing.
  const inFlight = busy || archiving;
  const actionDisabled = inFlight || count === 0;
  // Archive is a session verb: a workspace has no archive state, so a caller
  // that passes `onArchive` in workspace mode cannot draw one here.
  const showArchive = mode === 'session' && Boolean(onArchive);
  const actionClass = 'min-w-0 w-full h-7 flex items-center justify-center gap-1 px-2 rounded border text-[11px] font-medium transition-colors cursor-pointer disabled:opacity-40';
  const actionIdle = 'border-ink/20 text-ink hover:bg-ink/5';

  return (
    <div
      data-testid="batch-action-bar"
      className={`border-t border-ink/15 bg-paper ${drawer ? 'px-3' : 'px-2.5'} py-2 flex flex-col gap-1.5 flex-shrink-0`}
    >
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="min-w-0 truncate text-ink/70">
          <span className="font-semibold text-ink">{count}</span>
          {' '}of {total} {total === 1 ? noun : `${noun}s`} selected{where}
        </span>
        <button
          type="button"
          onClick={onCancel}
          disabled={inFlight}
          title="Cancel selection"
          aria-label="Cancel selection"
          className="shrink-0 w-5 h-5 flex items-center justify-center rounded text-ink/50 hover:text-ink hover:bg-ink/10 transition-colors cursor-pointer disabled:opacity-50"
        >
          <X size={13} />
        </button>
      </div>

      <div className={`grid gap-1.5 ${showArchive ? 'grid-cols-2' : 'grid-cols-3'}`}>
        <button
          type="button"
          onClick={onSelectAll}
          disabled={inFlight || total === 0 || count === total}
          className={`${actionClass} ${actionIdle}`}
        >
          <CheckCheck size={12} className="shrink-0" />
          <span className="truncate">Select all</span>
        </button>
        <button
          type="button"
          onClick={onUnselectAll}
          disabled={inFlight || count === 0}
          className={`${actionClass} ${actionIdle}`}
        >
          <span className="truncate">Unselect all</span>
        </button>
        {showArchive && (
          <button
            type="button"
            onClick={onArchive}
            disabled={actionDisabled}
            className={`${actionClass} ${actionIdle}`}
          >
            {archiving ? (
              <>
                <Loader2 size={12} className="animate-spin shrink-0" />
                <span className="truncate">Archiving…</span>
              </>
            ) : (
              <>
                <Archive size={12} className="shrink-0" />
                <span className="truncate">Archive {count > 0 ? `${count} ${plural}` : plural}</span>
              </>
            )}
          </button>
        )}
        <button
          type="button"
          onClick={onDelete}
          disabled={actionDisabled}
          className="min-w-0 w-full h-7 flex items-center justify-center gap-1 px-2 rounded bg-error text-canvas text-[11px] font-semibold hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-40"
        >
          {busy ? (
            <>
              <Loader2 size={12} className="animate-spin shrink-0" />
              <span className="truncate">Deleting…</span>
            </>
          ) : (
            <>
              <Trash2 size={12} className="shrink-0" />
              <span className="truncate">
                Delete {count > 0 ? `${count} ${plural}` : plural}
              </span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
