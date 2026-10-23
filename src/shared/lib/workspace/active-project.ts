import type { WorkspaceFolderData } from '@/shared/types';

export interface ActiveProjectScope {
  folder: WorkspaceFolderData | null;
  /** Registered project root of the selected session's workspace, or null. */
  projectPath: string | null;
}

/**
 * Resolve the workspace folder that owns the currently selected session and,
 * when that folder is bound to an oh-my-pi project (project_path), the project
 * root the right-panel developer tools should be scoped to.
 */
export function activeProjectForSession(
  folders: WorkspaceFolderData[],
  sessionId: string | number | null | undefined
): ActiveProjectScope {
  if (!sessionId) return { folder: null, projectPath: null };
  for (const folder of folders) {
    const ownsSession = (folder.sessions || []).some((s) => String(s.id) === String(sessionId));
    if (ownsSession) return { folder, projectPath: folder.project_path ?? null };
  }
  return { folder: null, projectPath: null };
}

/**
 * The root the right-panel tools should operate on for this session: its own
 * worktree when the session's cwd is a linked checkout, else the folder's
 * registered project path.
 *
 * A worktree session runs OUTSIDE its folder's project directory, so pointing
 * the panels at `project_path` showed the checkout the agent had left — measured:
 * every panel kept reading the main tree while the run wrote to the worktree.
 * The server's `resolveRoot` accepts a worktree of a registered project for the
 * same reason, so the two agree about what is readable.
 */
export function effectiveRootFor(
  folders: WorkspaceFolderData[],
  sessionId: string | number | null | undefined,
): string | null {
  const { folder } = activeProjectForSession(folders, sessionId);
  if (!folder) return null;
  const row = (folder.sessions || []).find((session) => String(session.id) === String(sessionId));
  const worktree = row?.worktree;
  if (worktree && worktree.status === 'ready') return worktree.path;
  return folder.project_path ?? null;
}

/**
 * Resolve the workspace root the composer should scope `@` file mentions to:
 * the active session's bound project first, then the explicitly selected
 * folder, else null (client falls back to the app root).
 */
export function composerRootFor(
  folders: WorkspaceFolderData[],
  sessionId: string | number | null | undefined,
  selectedFolderId: number | null
): string | null {
  const bySession = activeProjectForSession(folders, sessionId).folder;
  const byFolder =
    selectedFolderId != null
      ? folders.find((f) => String(f.id) === String(selectedFolderId)) ?? null
      : null;
  return (bySession ?? byFolder)?.project_path ?? null;
}
