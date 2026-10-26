/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The strips that stand between the toolbar and the document.
 *
 * Three of them, and each is a different fact about the same file:
 *
 * - **external change** — the disk moved while the buffer has edits, and nothing has
 *   been written yet;
 * - **conflict** — a save was REFUSED because the disk moved, so the buffer is ahead
 *   and the server declined to overwrite;
 * - **deleted** — the file is gone from disk, which the tab strip also says but in a
 *   small target in a crowded row.
 *
 * They sit above the document rather than in a modal because the user has to see the
 * file they are choosing about, and they are one component rather than three call
 * sites because two of them must never render together: a conflict is the LATER
 * state of an external change, so showing both would ask the same question twice.
 */

import { ExternalChangeStrip } from '@/client/components/workspace/editor/ExternalChangeStrip';
import { ConflictStrip } from '@/client/components/workspace/editor/ConflictStrip';
import type { DiskChange } from '@/client/hooks/editor/use-external-change';
import type { WriteConflict } from '@/client/hooks/editor/use-write-conflict';
import type { OpenedFile } from '@/shared/types/fs';

interface EditorNoticesProps {
  activeFile: OpenedFile | undefined;
  /** The disk moved under a dirty buffer, or null. */
  externalChange: DiskChange | null;
  /** A save was refused because the disk moved, or null. */
  conflict: WriteConflict | null;
  /** Take the disk copy and drop the buffer's edits. */
  onReload: () => void;
  /** Adopt the disk's mtime and keep editing. */
  onKeepMine: () => void;
}

export function EditorNotices({
  activeFile,
  externalChange,
  conflict,
  onReload,
  onKeepMine,
}: EditorNoticesProps) {
  if (!activeFile) return null;

  // The conflict wins: it is the later state of the same story, and it is the one
  // whose answer writes bytes. Offering both would be two controls for one choice.
  if (conflict) {
    return (
      <ConflictStrip
        diskMtimeMs={conflict.diskMtimeMs}
        fileName={activeFile.name}
        onReload={onReload}
        onKeepMine={onKeepMine}
      />
    );
  }

  if (externalChange) {
    return (
      <ExternalChangeStrip fileName={activeFile.name} onReload={onReload} onKeepMine={onKeepMine} />
    );
  }

  return null;
}
