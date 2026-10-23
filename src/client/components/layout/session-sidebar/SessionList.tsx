import { Category } from '@/client/components/layout/session-sidebar/CategoryItem';
import type { BatchBinding } from '@/client/components/common/batch-selection/types';
import type { WorkspaceFolderData } from '@/shared/types';

interface SessionSidebarSessionListProps {
  folders: WorkspaceFolderData[];
  activeSessionId: number | string | null;
  searchQuery: string;
  showArchived: boolean;
  sessionStatus: Record<string, 'stream' | 'finish' | 'abort'>;
  onSelectSession: (id: number | string) => void;
  onNewSessionForFolder: (id: number) => void;
  /** Start a chat in a worktree made from this folder. */
  onNewWorktreeSession?: (folderId: number, worktreePath: string) => void;
  /** Surfaces a refused folder action (the reveal endpoint's own reason). */
  onToast?: (message: string, type?: 'success' | 'error') => void;
  /** Present only while a batch selection is active. */
  batch?: BatchBinding;
  onStartSessionSelection?: (folderId: number) => void;
  /** Drop a held prompt from its row's menu. */
  onCancelWait?: (waitId: string) => void;
}

export function SessionSidebarSessionList({
  folders,
  activeSessionId,
  searchQuery,
  showArchived,
  sessionStatus,
  onSelectSession,
  onNewSessionForFolder,
  onNewWorktreeSession,
  onToast,
  batch,
  onStartSessionSelection,
  onCancelWait,
}: SessionSidebarSessionListProps) {
  // No fade wiring here: the app-wide scrollbar rule reveals this list's bar
  // from the document's own capture-phase listener (`lib/scrollbar-activity`),
  // so the list does not need a ref, a handler, or a re-render per scroll.
  return (
    <div className="flex-1 scrollbar-overlay-container p-2 space-y-4">
      {folders.length === 0 ? (
        <div className="text-center py-8 text-xs text-ink/40">
          {searchQuery ? 'No results found.' : 'No workspaces available.'}
        </div>
      ) : (
        folders.map(folder => (
          <Category 
            key={folder.id} 
            folder={folder} 
            activeSessionId={activeSessionId}
            onSelectSession={onSelectSession}
            onNewSessionForFolder={onNewSessionForFolder}
            forceExpanded={!!searchQuery}
            showArchived={showArchived}
            sessionStatus={sessionStatus}
            onToast={onToast}
            batch={batch}
            onStartSessionSelection={onStartSessionSelection}
            onCancelWait={onCancelWait}
          />
        ))
      )}
    </div>
  );
}
