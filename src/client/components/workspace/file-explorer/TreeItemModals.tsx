/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The dialogs ONE row owns: create, delete, rename and git history.
 *
 * Split from `TreeItem.tsx` so the row keeps its markup and click/drag wiring
 * and stays under the repository's line ceiling — the dialogs are pure
 * projection of `useFileActions` state. The delete dialog is also the panel's
 * multi-delete confirmation: a marked selection opens it with a count, because
 * "delete 4 items" deserves the same explicit confirm as one file.
 */

import { FileCreateModal, FileDeleteModal, FileHistoryModal, FileRenameModal } from '@/client/components/workspace/file-explorer/Modals';
import type { FileActions } from '@/client/hooks/workspace/file-tree-actions';

export interface TreeItemModalsProps {
  actions: FileActions;
  file: { path: string; name: string };
  isFolder: boolean;
  /** The row label when it is a collapsed chain, so Rename can explain itself. */
  chainLabel?: string;
}

export function TreeItemModals({ actions, file, isFolder, chainLabel }: TreeItemModalsProps) {
  const count = actions.selectionCount;
  return (
    <>
      {actions.showCreateModal && (
        <FileCreateModal
          folderPath={file.path}
          kind={actions.createKind}
          value={actions.createName}
          error={actions.createError}
          isLoading={actions.busy}
          onChange={actions.setCreateName}
          onCancel={actions.closeCreate}
          onSubmit={actions.submitCreate}
        />
      )}

      {actions.showDeleteModal && (
        <FileDeleteModal
          fileName={file.path}
          displayName={count > 1 ? undefined : chainLabel}
          isFolder={isFolder}
          count={count}
          isLoading={actions.busy}
          onCancel={actions.closeDelete}
          onConfirm={actions.submitDelete}
        />
      )}

      {actions.showRenameModal && (
        <FileRenameModal
          isFolder={isFolder}
          renameValue={actions.renameValue}
          originalPath={file.path}
          displayName={isFolder ? chainLabel : undefined}
          error={actions.renameError}
          isLoading={actions.busy}
          onChange={actions.setRenameValue}
          onCancel={actions.closeRename}
          onSubmit={actions.submitRename}
        />
      )}

      {actions.showHistoryModal && (
        <FileHistoryModal
          filePath={file.path}
          fetcherState={actions.fetcherState}
          fetcherData={actions.fetcherData}
          onClose={actions.closeHistory}
        />
      )}
    </>
  );
}
