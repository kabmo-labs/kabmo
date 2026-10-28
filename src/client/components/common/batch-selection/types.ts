/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The props a category/folder hands down to its rows while a batch selection is
 * active, shared by the desktop category and the phone's drawer item.
 *
 * It is one object rather than six props because every field is only meaningful
 * together: a `selected` list without a `mode` is a selection nothing draws, and
 * a `scopeFolderId` without the session mode is a scope nothing applies to. Both
 * layouts read the same shape, so a row cannot grow a checkbox on one layout and
 * not the other.
 */

import type { BatchMode, SelectionSummary } from '@/shared/lib/workspace/batch-select';

export interface BatchBinding {
  /** The active mode, or null when the sidebar is not selecting. */
  mode: BatchMode | null;
  /** The workspace a SESSION selection is scoped to (null in workspace mode). */
  scopeFolderId: number | null;
  /** Ids currently selected, in click order. */
  selected: readonly string[];
  toggle: (id: string) => void;
  selectAllOf: (ids: readonly string[]) => void;
  unselectAllOf: (ids: readonly string[]) => void;
  /** Tri-state summary over a set of ids the folder can offer. */
  summaryOf: (available: readonly string[]) => SelectionSummary;
}

/** True when this folder's own header should draw a checkbox. */
export function headerSelectable(binding: BatchBinding, folderId: number): boolean {
  return binding.mode === 'workspace'
    || (binding.mode === 'session' && binding.scopeFolderId === folderId);
}

/** True when this folder's SESSION rows should draw checkboxes. */
export function rowsSelectable(binding: BatchBinding, folderId: number): boolean {
  return binding.mode === 'session' && binding.scopeFolderId === folderId;
}
