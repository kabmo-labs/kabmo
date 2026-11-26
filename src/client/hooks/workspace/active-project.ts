/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The workspace the open session belongs to: the project folder, its root, and
 * whether one exists at all.
 *
 * Extracted from `DesktopLayout` for the repository's per-file ceiling, and it
 * is one fact rather than three: the folder pick, the session's own root and
 * `hasActiveContext` are the same question asked at three resolutions, and a
 * layout that derived them separately let a worktree session read its original
 * checkout.
 */

import { useMemo } from 'preact/hooks';
import { useSearchParams } from '@/client/lib/router/search-params';
import { activeProjectForSession, effectiveRootFor } from '@/shared/lib/workspace/active-project';
import type { WorkspaceFolderData } from '@kabmo-labs/kabmo-app-contracts/workspace';

export interface ActiveWorkspaceProject {
  folder: WorkspaceFolderData | null;
  /** The root panels read: the session's own (a worktree) or its folder's. */
  path: string | null;
  hasActiveContext: boolean;
}

export function useActiveWorkspaceProject(folders: WorkspaceFolderData[], sessionId: string | null): ActiveWorkspaceProject {
  const [searchParams] = useSearchParams();
  const folderIdParam = searchParams.get('folderId');
  const folder = useMemo(() => {
    const sessionFolder = activeProjectForSession(folders, sessionId || '').folder;
    if (sessionFolder) return sessionFolder;
    if (folderIdParam) return folders.find((entry) => String(entry.id) === String(folderIdParam)) ?? null;
    return null;
  }, [folders, sessionId, folderIdParam]);
  // A worktree session runs OUTSIDE its folder's project path, so the panels
  // follow the session's own root — the checkout it left would otherwise be what
  // Files, Search, Git and the terminal read.
  const path = useMemo(
    () => effectiveRootFor(folders, sessionId || '') ?? folder?.project_path ?? null,
    [folders, sessionId, folder],
  );
  return { folder, path, hasActiveContext: !!folder };
}
