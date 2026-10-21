import { MobileSessionCategory } from '@/client/components/mobile/mobile-session-sidebar/Item';
import type { BatchBinding } from '@/client/components/common/batch-selection/types';
import type { WorkspaceFolderData } from '@/shared/types';

interface MobileSessionListProps {
  folders: WorkspaceFolderData[];
  activeSessionId: number | string | null;
  expandedFolders: Record<number, boolean>;
  showArchived: boolean;
  sessionStatus: Record<string, 'stream' | 'finish' | 'abort'>;
  onSelectSession: (id: number | string) => void;
  onNewSessionForFolder: (folderId: number) => void;
  onToggleFolder: (folderId: number) => void;
  /** Surfaces a refused folder action (the reveal endpoint's own reason). */
  onToast?: (message: string, type?: 'success' | 'error') => void;
  /** Present only while a batch selection is active. */
  batch?: BatchBinding;
  onStartSessionSelection?: (folderId: number) => void;
  /** Drop a held prompt from its row's menu. */
  onCancelWait?: (waitId: string) => void;
}

export function MobileSessionList({
  folders,
  activeSessionId,
  expandedFolders,
  showArchived,
  sessionStatus,
  onSelectSession,
  onNewSessionForFolder,
  onToggleFolder,
  onToast,
  batch,
  onStartSessionSelection,
  onCancelWait,
}: MobileSessionListProps) {
  // No fade wiring here: the app-wide scrollbar rule reveals this list's bar
  // from the document's own capture-phase listener (`lib/scrollbar-activity`),
  // so the list does not need a ref, a handler, or a re-render per scroll.
  // `pl-3 pr-2`, not an even `p-3`: this container scrolls, so its scrollbar is
  // taken out of the box and the same 12px on both sides LOOKS wider on the
  // right. One step less on the right evens the optical margin back up, and it
  // is why the rows below are aligned to 12 and not to 12 + the bar.
  return (
    <div className="flex-1 scrollbar-overlay-container pl-3 pr-2 py-3">
      {folders.length === 0 ? (
        <div className="text-center py-12 text-xs text-ink/50 italic">
          No matching sessions found
        </div>
      ) : (
        folders.map(folder => (
          <MobileSessionCategory
            key={folder.id}
            folder={folder}
            activeSessionId={activeSessionId}
            onSelectSession={onSelectSession}
            onNewSessionForFolder={onNewSessionForFolder}
            isExpanded={expandedFolders[folder.id] ?? true}
            onToggleExpand={() => onToggleFolder(folder.id)}
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
