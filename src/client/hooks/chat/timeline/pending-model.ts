/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The model a PENDING chat will start on.
 *
 * The composer on a `new-…` chat has no session to read a model from, so its
 * pill showed Kabmo's registry default while `POST /api/agent/new` applies the
 * workspace's own default first. The two disagreed for exactly the project the
 * user had configured a default for. This resolves the same value the spawn
 * does, from the folder row the composer is bound to.
 */

import { useMemo } from 'preact/hooks';
import type { SelectedModel, WorkspaceFolderData } from '@/shared/types';
import { parseProjectModel } from '@/shared/lib/workspace/project-model';

export function usePendingProjectModel(
  folders: WorkspaceFolderData[],
  selectedFolderId: number | null,
): SelectedModel | null {
  return useMemo(() => {
    const folder = folders.find((row) => String(row.id) === String(selectedFolderId));
    return parseProjectModel(folder?.model);
  }, [folders, selectedFolderId]);
}
