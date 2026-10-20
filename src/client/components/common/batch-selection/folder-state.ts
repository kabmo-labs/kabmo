/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * One folder's batch state, shared by the desktop category and the phone's
 * drawer item.
 *
 * The two layouts draw the same rules — which checkbox the header carries, what
 * its tri-state reports, which rows are selectable, and how the pagination
 * window behaves — and they had drifted into two copies of that arithmetic.
 * Stating it once is what keeps "select all" counting the same rows on a phone
 * and on a desktop.
 *
 * Three rules are load-bearing:
 *
 *   - a workspace checkbox exists in BOTH modes, but means different things: the
 *     folder itself in `workspace` mode, its rows in `session` mode;
 *   - the summary is computed over the rows the ARCHIVE FILTER offers, so
 *     "select all" can never reach a row the user cannot see or unselect;
 *   - a session selection lifts the pagination window, because a window would
 *     tick rows that have no checkbox on screen.
 */

import { selectableSessionIds } from '@/shared/lib/workspace/batch-select';
import { selectVisibleSessions } from '@/shared/lib/workspace/session-visibility';
import { headerSelectable, rowsSelectable } from '@/client/components/common/batch-selection/types';
import type { BatchBinding } from '@/client/components/common/batch-selection/types';
import type { SessionItemData, WorkspaceFolderData } from '@/shared/types';

export interface FolderBatchInput {
  batch?: BatchBinding;
  folder: WorkspaceFolderData;
  /** The rows the archive filter currently offers. */
  sessions: SessionItemData[];
  showArchived: boolean;
  /** The list's page size (`useShowMore`), unused while selecting. */
  visibleCount: number;
  activeSessionId: number | string | null;
  sessionStatus?: Record<string, string | undefined>;
}

export interface FolderBatchState {
  /** The header draws a checkbox (workspace mode, or this folder's session mode). */
  folderCheckbox: boolean;
  /** The rows draw checkboxes. */
  sessionCheckboxes: boolean;
  /** Null when the header has no checkbox. */
  folderSummary: { count: number; all: boolean; some: boolean } | null;
  /** What the header checkbox selects. */
  selectableIds: string[];
  /** Header click: select or unselect everything this header owns. */
  toggleFolderSelection: () => void;
  /** Rows to render — every offered row while selecting, else the window. */
  rendered: SessionItemData[];
  /** Rows the next "Show more" reveals; 0 while selecting. */
  hiddenCount: number;
}

export function folderBatchState({
  batch,
  folder,
  sessions,
  showArchived,
  visibleCount,
  activeSessionId,
  sessionStatus,
}: FolderBatchInput): FolderBatchState {
  const folderCheckbox = batch ? headerSelectable(batch, folder.id) : false;
  const sessionCheckboxes = batch ? rowsSelectable(batch, folder.id) : false;
  const selectableIds = sessionCheckboxes
    ? selectableSessionIds(sessions, showArchived)
    : folderCheckbox
      ? [String(folder.id)]
      : [];
  const folderSummary = batch && folderCheckbox ? batch.summaryOf(selectableIds) : null;

  const windowed = selectVisibleSessions(sessions, visibleCount, { activeSessionId, sessionStatus });

  const toggleFolderSelection = () => {
    if (!batch) return;
    if (folderCheckbox && !sessionCheckboxes) {
      batch.toggle(String(folder.id));
      return;
    }
    if (!sessionCheckboxes) return;
    if (folderSummary?.all) batch.unselectAllOf(selectableIds);
    else batch.selectAllOf(selectableIds);
  };

  return {
    folderCheckbox,
    sessionCheckboxes,
    folderSummary,
    selectableIds,
    toggleFolderSelection,
    rendered: sessionCheckboxes ? sessions : windowed.rendered,
    hiddenCount: sessionCheckboxes ? 0 : windowed.hiddenCount,
  };
}
