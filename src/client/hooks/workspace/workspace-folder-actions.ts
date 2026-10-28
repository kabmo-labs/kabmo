/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Workspace-folder mutations shared by the desktop category header and the
 * mobile category item: pin/unpin, delete, session archive, and session
 * rename. The fetchers and the delete confirmation flag all live here so the
 * two sidebars cannot drift on URLs or bodies; a successful mutation is
 * announced by the server (the `sidebar` topic) or on the client signal bus.
 *
 * The folder expand toggle is deliberately NOT here: the desktop submits it
 * through `useFetcher` (and re-dispatches on the response), while the mobile
 * sidebar issues a raw fetch and dispatches with a `folderId` detail. Those
 * two are not the same request/event contract, so each keeps its own.
 *
 * Callers keep their own menu-open state and the optimistic expand flag — the
 * hook is about the request + refresh, not the local UI toggles.
 */

import { useState } from 'preact/hooks';
import { useFetcher } from '@/client/lib/router/fetcher';
import { useSessionActions } from '@/client/hooks/workspace/session-actions';
import type { SessionItemData } from '@/shared/types';

/** Minimal folder shape the actions touch — avoids coupling to a full row. */
export interface WorkspaceFolderLike {
  id: number | string;
  isPinned?: boolean;
  project_path?: string | null;
}

export interface WorkspaceFolderActions {
  /** True while the delete confirmation is showing. */
  confirmDelete: boolean;
  /** Enter the delete confirmation step. */
  requestDelete: () => void;
  /** Leave the delete confirmation step without deleting. */
  cancelDelete: () => void;
  handlePin: () => void;
  /**
   * Reveal the workspace directory in the platform file manager.
   *
   * Present only when the folder is bound to a directory — an unbound folder
   * is a grouping with no path, and the menu omits the item rather than
   * offering one that can only fail.
   */
  handleOpenFolder?: () => void;
  handleDelete: () => void;
  handleArchive: (session: SessionItemData) => void;
  handleRename: (session: SessionItemData, name: string) => Promise<void>;
  /** Ask omp to name the session from its transcript, reporting the outcome. */
  handleRenameWithAi: (session: SessionItemData) => Promise<void>;
}

/**
 * The one channel a folder action reports on, success or failure.
 *
 * A message is always the surface's own or the server's — a directory that no
 * longer exists and a machine with no opener are different problems, and the
 * old fire-and-forget call could not report either. The tone is optional
 * because the session actions this hook forwards to report SUCCESS through the
 * same channel ("Renamed to …"), while a folder's own failures are the error
 * tone their callers already assume.
 */
export type ReportFolderOutcome = (message: string, tone?: 'success' | 'error') => void;

export function useWorkspaceFolderActions(
  folder: WorkspaceFolderLike,
  refresh: () => void,
  report?: ReportFolderOutcome,
): WorkspaceFolderActions {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const pinFetcher = useFetcher<{ success?: boolean }>();
  const deleteFetcher = useFetcher<{ success?: boolean }>();
  const { handleArchive, handleRename, handleRenameWithAi } = useSessionActions(refresh, report);

  const handlePin = () => {
    if (typeof folder.id !== 'number') return;
    pinFetcher.submit(
      { isPinned: String(!folder.isPinned) },
      { method: 'POST', action: `/api/folders/${folder.id}/pin` }
    );
    refresh();
  };

  const handleDelete = () => {
    if (typeof folder.id !== 'number') return;
    deleteFetcher.submit(
      {},
      { method: 'POST', action: `/api/folders/${folder.id}/delete` }
    );
    setConfirmDelete(false);
    refresh();
  };

  // Reveal is a plain await rather than a fetcher: there is no follow-up state
  // to render, and the answer is a verdict the user has to be told either way.
  const handleOpenFolder = folder.project_path
    ? () => {
        void (async () => {
          try {
            const res = await fetch(`/api/folders/${encodeURIComponent(String(folder.id))}/open`, { method: 'POST' });
            const data = await res.json().catch(() => ({})) as { error?: string };
            if (!res.ok) report?.(data.error || `Could not open the folder (HTTP ${res.status})`);
          } catch (error) {
            report?.(error instanceof Error ? error.message : String(error));
          }
        })();
      }
    : undefined;

  return {
    confirmDelete,
    requestDelete: () => setConfirmDelete(true),
    cancelDelete: () => setConfirmDelete(false),
    handlePin,
    handleOpenFolder,
    handleDelete,
    handleArchive,
    handleRename,
    handleRenameWithAi,
  };
}
