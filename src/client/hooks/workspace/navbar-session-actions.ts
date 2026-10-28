/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The navbar's session menu, resolved from the session ON SCREEN.
 *
 * A hook rather than three statements in the layout because the lookup has a
 * rule of its own: the session's row may live in a folder that is not expanded
 * in the sidebar (or not visible at all), so it is found by id across every
 * folder instead of by walking the visible list. No row means no menu — a
 * session the sidebar does not know (a chat running outside every registered
 * workspace) gets nothing rather than dead items.
 *
 * The pending `new-…` refusal lives here too: such a chat has no transcript
 * anywhere yet, so the server refuses rename and delete, and the menu hides
 * them the way the sidebar does.
 */

import { useMemo } from 'preact/hooks';
import { useSidebarData } from '@/client/hooks/chat/omp/session-list';
import { useSessionActions } from '@/client/hooks/workspace/session-actions';
import { useSessionDelete, type SessionDeleteActions } from '@/client/hooks/workspace/session-delete';
import type { WorkspaceFolderData } from '@/shared/types';

/** What `TopNavbar` needs to draw its title menu. */
export interface NavbarSessionMenu {
  isArchived: boolean;
  onRename?: (name: string) => void;
  onRenameWithAi?: () => void;
  onArchive: () => void;
  onDelete?: () => void;
}

export interface NavbarSessionActions {
  menu: NavbarSessionMenu | undefined;
  /** The delete confirmation's own state machine, which the layout renders. */
  sessionDelete: SessionDeleteActions;
}

export function useNavbarSessionActions(
  folders: WorkspaceFolderData[],
  sessionId: string | null,
  report: (message: string, tone?: 'success' | 'error') => void,
): NavbarSessionActions {
  const sidebar = useSidebarData();
  const actions = useSessionActions(sidebar.refresh, report);
  const sessionDelete = useSessionDelete();

  const activeSession = useMemo(() => {
    if (!sessionId) return null;
    for (const folder of folders) {
      const found = (folder.sessions || []).find((s) => String(s.id) === String(sessionId));
      if (found) return found;
    }
    return null;
  }, [folders, sessionId]);

  const pending = Boolean(sessionId && sessionId.startsWith('new-'));
  const menu: NavbarSessionMenu | undefined = activeSession
    ? {
        isArchived: activeSession.is_archived === 1,
        onRename: pending ? undefined : (name: string) => void actions.handleRename(activeSession, name),
        onRenameWithAi: pending ? undefined : () => void actions.handleRenameWithAi(activeSession),
        onArchive: () => actions.handleArchive(activeSession),
        onDelete: pending ? undefined : () => sessionDelete.requestDelete(activeSession),
      }
    : undefined;

  return { menu, sessionDelete };
}
