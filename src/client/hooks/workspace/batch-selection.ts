/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * One batch selection, for both sidebars and both nouns.
 *
 * The mode is the state that makes the checkboxes exist at all: `null` means
 * the sidebar is behaving normally, and entering a mode is the user's explicit
 * act (a workspace's `⋯` menu, or the toolbar's Select control). Leaving it —
 * by Cancel, by Escape, or by finishing a delete — clears the selection, so a
 * mode never comes back pre-filled with rows the user no longer remembers
 * picking.
 *
 * The selection is pruned against what the sidebar can currently offer, but
 * pruning is deliberately NOT done in an effect: a row that disappears for one
 * render (a folder collapsing under a filter, a push mid-refresh) must not
 * silently drop a choice. Callers pass the ids they are about to delete, and
 * the delete path resolves them against the live list.
 */

import { useCallback, useMemo, useState } from 'preact/hooks';
import {
  selectionSummary,
  toggleSelection,
  type BatchMode,
  type SelectionSummary,
} from '@/shared/lib/workspace/batch-select';

export interface BatchSelectionHandle {
  /** The active mode, or null when the sidebar is not selecting. */
  mode: BatchMode | null;
  /**
   * The workspace a SESSION selection is scoped to. A session batch is started
   * from one workspace's `⋯` menu, so the checkboxes belong to that workspace's
   * rows only — the other folders stay ordinary lists, which is also what makes
   * "select all" unambiguous. Null in workspace mode.
   */
  scopeFolderId: number | null;
  /** The ids selected in the active mode, in click order. */
  selected: string[];
  /** Enter a mode, replacing any previous selection. */
  begin: (mode: BatchMode, scopeFolderId?: number) => void;
  /** Leave the mode and forget the selection. */
  end: () => void;
  /** Add or remove one id. */
  toggle: (id: string) => void;
  /** Add every id in `ids` that is not already selected. */
  selectAllOf: (ids: readonly string[]) => void;
  /** Drop every id in `ids` from the selection. */
  unselectAllOf: (ids: readonly string[]) => void;
  /** Tri-state summary of the selection against a set of available ids. */
  summaryOf: (available: readonly string[]) => SelectionSummary;
}

export function useBatchSelection(): BatchSelectionHandle {
  const [mode, setMode] = useState<BatchMode | null>(null);
  const [scopeFolderId, setScopeFolderId] = useState<number | null>(null);
  const [selected, setSelected] = useState<string[]>([]);

  const begin = useCallback((next: BatchMode, folderId?: number) => {
    setMode(next);
    setScopeFolderId(next === 'session' ? folderId ?? null : null);
    setSelected([]);
  }, []);

  const end = useCallback(() => {
    setMode(null);
    setScopeFolderId(null);
    setSelected([]);
  }, []);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => toggleSelection(prev, id));
  }, []);

  const selectAllOf = useCallback((ids: readonly string[]) => {
    setSelected((prev) => [...new Set([...prev, ...ids])]);
  }, []);

  const unselectAllOf = useCallback((ids: readonly string[]) => {
    setSelected((prev) => {
      const drop = new Set(ids);
      return prev.filter((id) => !drop.has(id));
    });
  }, []);

  const summaryOf = useCallback(
    (available: readonly string[]) => selectionSummary(selected, available),
    [selected],
  );

  return useMemo(
    () => ({ mode, scopeFolderId, selected, begin, end, toggle, selectAllOf, unselectAllOf, summaryOf }),
    [mode, scopeFolderId, selected, begin, end, toggle, selectAllOf, unselectAllOf, summaryOf],
  );
}
