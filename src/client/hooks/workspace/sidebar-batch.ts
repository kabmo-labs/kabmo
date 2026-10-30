/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The batch machine, wired once for both sidebars.
 *
 * `useBatchSelection` and `useBatchDeleteRun` are the state; this joins them to
 * the list that is actually on screen, because three facts have to be computed
 * the same way by the desktop dock and the phone drawer or the bar claims
 * something the user cannot act on:
 *
 * - **the scope folder** — the workspace a SESSION batch belongs to, found in
 *   the RENDERED list (a folder that was deleted under the selection is not a
 *   scope);
 * - **what is available** — every workspace id in workspace mode, the scope
 *   folder's offerable rows in session mode, nothing otherwise;
 * - **what is selected** — `liveSelection`, so an id that vanished from the
 *   list is neither counted nor sent to the server.
 *
 * The binding object it returns is the shape both category components read
 * (`BatchBinding`), so a row cannot grow a checkbox in one layout and not the
 * other.
 */

import { useCallback } from 'preact/hooks';
import { useBatchSelection } from '@/client/hooks/workspace/batch-selection';
import { useBatchDeleteRun } from '@/client/hooks/workspace/batch-delete-run';
import { liveSelection, selectableSessionIds } from '@/shared/lib/workspace/batch-select';
import type { BatchSelectionHandle } from '@/client/hooks/workspace/batch-selection';
import type { BatchDeleteRun } from '@/client/hooks/workspace/batch-delete-run';
import type { BatchBinding } from '@/client/components/common/batch-selection/types';
import type { WorkspaceFolderData } from '@/shared/types';

export interface SidebarBatch {
  /** The raw selection handle, for the bar's select-all/unselect-all and end. */
  selection: BatchSelectionHandle;
  /** The same machine's delete run, for the bar and the confirmation dialog. */
  deleteRun: BatchDeleteRun;
  /** Present only while a mode is active. */
  binding: BatchBinding | undefined;
  /** The workspace a session batch is scoped to, or null. */
  scopeFolder: WorkspaceFolderData | null;
  /** Ids the bar may act on right now. */
  available: string[];
  /** Ids actually selected, pruned against `available`. */
  selected: string[];
  /** The toolbar/chip Select control: toggles workspace mode. */
  toggleWorkspaceSelection: () => void;
}

export function useSidebarBatch(
  folders: WorkspaceFolderData[],
  showArchived: boolean,
  refresh: () => void,
): SidebarBatch {
  const selection = useBatchSelection();
  const deleteRun = useBatchDeleteRun(refresh);

  const scopeFolder = selection.scopeFolderId === null
    ? null
    : folders.find((folder) => folder.id === selection.scopeFolderId) ?? null;

  const available = selection.mode === 'workspace'
    ? folders.map((folder) => String(folder.id))
    : selection.mode === 'session'
      ? selectableSessionIds(scopeFolder?.sessions ?? [], showArchived)
      : [];
  const selected = liveSelection(selection.selected, available);

  const binding: BatchBinding | undefined = selection.mode
    ? {
        mode: selection.mode,
        scopeFolderId: selection.scopeFolderId,
        selected: selection.selected,
        toggle: selection.toggle,
        selectAllOf: selection.selectAllOf,
        unselectAllOf: selection.unselectAllOf,
        summaryOf: selection.summaryOf,
      }
    : undefined;

  const toggleWorkspaceSelection = useCallback(() => {
    if (selection.mode === 'workspace') selection.end();
    else selection.begin('workspace');
  }, [selection]);

  return { selection, deleteRun, binding, scopeFolder, available, selected, toggleWorkspaceSelection };
}
