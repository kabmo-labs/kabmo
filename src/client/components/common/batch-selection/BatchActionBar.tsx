/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The bar a batch selection raises: what is selected, select-all / unselect-all,
 * Delete and Cancel.
 *
 * It sits at the bottom of the sidebar (desktop) or above the list (phone) and
 * is the ONLY place a delete can be started — the checkboxes themselves never
 * act, so a mis-tap on a row cannot delete anything. Select-all and unselect-all
 * are two buttons rather than one toggle: after a partial selection the user
 * needs both directions, and one alternating control cannot say which it means.
 *
 * The scope noun is the mode's, not the bar's: "Select all" on the session mode
 * means every session of the workspace whose menu started it, and on the
 * workspace mode every workspace on screen.
 */

import { CheckCheck, Loader2, Trash2, X } from 'lucide-preact';
import type { BatchMode } from '@/shared/lib/workspace/batch-select';

export interface BatchActionBarProps {
  mode: BatchMode;
  /** How many rows are selected. */
  count: number;
  /** How many the scope can offer — the denominator of "3 of 12". */
  total: number;
  /** True while a batch delete is in flight. */
  busy: boolean;
  /** The scope's name, for the sentence ("in kabmo"). Omitted in workspace mode. */
  scopeLabel?: string;
  onSelectAll: () => void;
  onUnselectAll: () => void;
  onDelete: () => void;
  onCancel: () => void;
}

export function BatchActionBar({
  mode,
  count,
  total,
  busy,
  scopeLabel,
  onSelectAll,
  onUnselectAll,
  onDelete,
  onCancel,
}: BatchActionBarProps) {
  const noun = mode === 'workspace' ? 'workspace' : 'session';
  const plural = count === 1 ? noun : `${noun}s`;
  const where = mode === 'session' && scopeLabel ? ` in ${scopeLabel}` : '';

  return (
    <div
      data-testid="batch-action-bar"
      className="border-t border-ink/15 bg-paper px-2.5 py-2 flex flex-col gap-1.5 flex-shrink-0"
    >
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="min-w-0 truncate text-ink/70">
          <span className="font-semibold text-ink">{count}</span>
          {' '}of {total} {total === 1 ? noun : `${noun}s`} selected{where}
        </span>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          title="Cancel selection"
          aria-label="Cancel selection"
          className="shrink-0 w-5 h-5 flex items-center justify-center rounded text-ink/50 hover:text-ink hover:bg-ink/10 transition-colors cursor-pointer disabled:opacity-50"
        >
          <X size={13} />
        </button>
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onSelectAll}
          disabled={busy || total === 0 || count === total}
          className="flex-1 min-w-0 h-7 flex items-center justify-center gap-1 px-2 rounded border border-ink/20 text-[11px] font-medium text-ink hover:bg-ink/5 transition-colors cursor-pointer disabled:opacity-40"
        >
          <CheckCheck size={12} className="shrink-0" />
          <span className="truncate">Select all</span>
        </button>
        <button
          type="button"
          onClick={onUnselectAll}
          disabled={busy || count === 0}
          className="flex-1 min-w-0 h-7 flex items-center justify-center gap-1 px-2 rounded border border-ink/20 text-[11px] font-medium text-ink hover:bg-ink/5 transition-colors cursor-pointer disabled:opacity-40"
        >
          <span className="truncate">Unselect all</span>
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={busy || count === 0}
          className="flex-1 min-w-0 h-7 flex items-center justify-center gap-1 px-2 rounded bg-error text-canvas text-[11px] font-semibold hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-40"
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
