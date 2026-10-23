/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The New Worktree dialog as a phone folder row opens it.
 *
 * Split out because the row was at the file-size ceiling and because the
 * dialog's state (open, and which folder) belongs to the dialog rather than to a
 * row that also draws sessions, a `⋯` menu and a delete confirmation. The row
 * calls the hook, hands `open` to its menu row and renders `dialog` at its tail —
 * the menu row has to stay INSIDE the dropdown, which is why this returns the
 * modal rather than the trigger.
 */

import { useState } from 'preact/hooks';
import { NewWorktreeModal } from '@/client/components/workspace/worktree-modal/index';
import type { WorkspaceFolderData } from '@/shared/types';

export interface WorktreeDialogHandle {
  open: () => void;
  /** Rendered at the row's tail; null until the dialog has been opened once. */
  dialog: preact.JSX.Element | null;
}

export function useWorktreeDialog(
  folder: WorkspaceFolderData,
  onCreated: (worktreePath: string) => void,
): WorktreeDialogHandle {
  const [isOpen, setIsOpen] = useState(false);

  return {
    open: () => setIsOpen(true),
    dialog: isOpen ? (
      <NewWorktreeModal
        isOpen
        onClose={() => setIsOpen(false)}
        root={folder.project_path ?? null}
        folderId={folder.id}
        folderName={folder.name}
        onCreated={(created) => {
          setIsOpen(false);
          onCreated(created.path);
        }}
      />
    ) : null,
  };
}