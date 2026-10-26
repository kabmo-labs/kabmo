/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The close guard, as one hook.
 *
 * The panel owns three things here and each needs the others: the dirty set the
 * editor publishes, the tab a close was asked for, and the buffer that has to be
 * written if the answer is "Save & close". Keeping them in the panel pushed that
 * file past the repository's line ceiling, and the cluster is self-contained —
 * one state, one dialog, one decision.
 *
 * ## Why only DIRTY tabs ask
 *
 * A confirm on every close is one people learn to dismiss without reading, which
 * is worse than none. A clean tab closes instantly; the dialog appears only where
 * there is something to lose.
 *
 * ## Why `saveNow` is not enough on its own
 *
 * `saveNow` writes the ACTIVE file. A background tab is saved by activating it
 * first, which is what the panel's `onSelectFile` does — and the activation has
 * to happen BEFORE the save call, because the hook reads its target from the
 * render it was built in.
 */

import { useCallback, useState } from 'preact/hooks';

import { isTabDirty } from '@/client/lib/editor-dirty-tabs';
import { useUnloadGuard, type DirtyCloseAnswer } from '@/client/hooks/editor/use-unload-guard';
import type { OpenedFile } from '@/shared/types/fs';

interface UseCloseGuardOptions {
  openedFiles: OpenedFile[];
  activeFileId: number | string | null;
  onSelectFile: (id: number | string) => void;
  onCloseFile: (id: number | string) => void;
  /** Writes the ACTIVE buffer; the caller activates the tab first. */
  saveNow: () => void;
}

export interface CloseGuard {
  /** Close a tab, asking first when it holds edits that are not on disk. */
  requestClose: (id: number | string) => void;
  /** The tab the dialog is asking about, or null. */
  pending: OpenedFile | null;
  /** The dialog's answer. */
  answer: (answer: DirtyCloseAnswer) => void;
}

export function useCloseGuard({
  openedFiles,
  activeFileId,
  onSelectFile,
  onCloseFile,
  saveNow,
}: UseCloseGuardOptions): CloseGuard {
  const [pending, setPending] = useState<OpenedFile | null>(null);
  // Armed only while something is dirty — see the hook's own note.
  useUnloadGuard();

  const requestClose = useCallback(
    (id: number | string) => {
      const file = openedFiles.find((entry) => entry.id === id);
      if (file && isTabDirty(id)) {
        setPending(file);
        return;
      }
      onCloseFile(id);
    },
    [openedFiles, onCloseFile],
  );

  const answer = useCallback(
    (decision: DirtyCloseAnswer) => {
      const file = pending;
      if (!file) return;
      if (decision === 'cancel') {
        setPending(null);
        return;
      }
      if (decision === 'save') {
        // `saveNow` writes the ACTIVE file, so a background tab is activated
        // first. The dialog closes with the tab either way; a failed write is
        // reported by the toolbar's own status, not here.
        if (file.id !== activeFileId) onSelectFile(file.id);
        saveNow();
      }
      setPending(null);
      onCloseFile(file.id);
    },
    [pending, activeFileId, onSelectFile, saveNow, onCloseFile],
  );

  return { requestClose, pending, answer };
}
