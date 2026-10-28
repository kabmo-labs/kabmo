/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The two questions the editor panel can ask, in one place.
 *
 * Both are MODALS and both outlive a tab switch, which is why neither is owned by the
 * component that raises it: the close confirmation is raised by the tab strip, and the
 * deleted-file confirmation by the write path — and a tab switch must not dismiss a
 * question the user has not answered.
 *
 * They are also mutually exclusive in practice (a save on a deleted file and a close on a
 * dirty one cannot both be waiting), so drawing them together would stack two backdrops.
 * The close confirmation wins, because it is the one that ends with a tab gone.
 */

import { CloseDirtyTabModal } from '@/client/hooks/editor/use-unload-guard';
import { SaveDeletedFileModal } from '@/client/components/workspace/editor/SaveDeletedFileModal';
import type { CloseGuard } from '@/client/hooks/editor/use-close-guard';
import type { OpenedFile } from '@/shared/types/fs';

interface EditorDialogsProps {
  closeGuard: CloseGuard;
  activeFile: OpenedFile | undefined;
  saveMissingConfirm: boolean;
  onCancelSaveMissing: () => void;
  onConfirmSaveMissing: () => void;
}

export function EditorDialogs({
  closeGuard,
  activeFile,
  saveMissingConfirm,
  onCancelSaveMissing,
  onConfirmSaveMissing,
}: EditorDialogsProps) {
  if (closeGuard.pending) {
    return <CloseDirtyTabModal fileName={closeGuard.pending.name} onAnswer={closeGuard.answer} />;
  }
  if (saveMissingConfirm && activeFile) {
    return (
      <SaveDeletedFileModal
        fileName={activeFile.name}
        filePath={activeFile.path}
        onClose={onCancelSaveMissing}
        onConfirm={onConfirmSaveMissing}
      />
    );
  }
  return null;
}
