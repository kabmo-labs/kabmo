/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The phone drawer's `classic` chrome: the toolbar of boxed controls over the
 * drawer's compact rows.
 *
 * Extracted from `SessionSidebar` VERBATIM so the style setting can switch it
 * for the modern chrome without moving any state. The drawer's controller, its
 * folder expansion, its batch machine and its dialogs stay in the dispatcher —
 * this file draws the two rows above the list and nothing else.
 */

import type { RefObject } from 'preact/compat';
import { MobileSessionToolbar } from '@/client/components/mobile/mobile-session-sidebar/Toolbar';
import { MobileSessionList } from '@/client/components/mobile/mobile-session-sidebar/List';
import { MobileSessionListSkeleton } from '@/client/components/mobile/mobile-session-sidebar/Skeleton';
import type { BatchBinding } from '@/client/components/common/batch-selection/types';
import type { SessionSortOption, WorkspaceFolderData } from '@/shared/types';

export interface ClassicDrawerProps {
  folders: WorkspaceFolderData[];
  initializing: boolean;
  activeSessionId: number | string | null;
  expandedFolders: Record<number, boolean>;
  sessionStatus: Record<string, 'stream' | 'finish' | 'abort'>;
  searchQuery: string;
  sortOption: SessionSortOption;
  optionsOpen: boolean;
  showArchived: boolean;
  optionsRef: RefObject<HTMLDivElement>;
  scheduledCount: number;
  refreshing: boolean;
  selecting: boolean;
  batch?: BatchBinding;
  onNewSession: () => void;
  onNewWorkspace: () => void;
  onScheduler: () => void;
  onRefresh: () => void;
  onToggleOptions: () => void;
  onSortChange: (option: SessionSortOption) => void;
  onResetSort: () => void;
  onToggleArchived: () => void;
  onHideArchived: () => void;
  onSearchChange: (value: string) => void;
  onClearSearch: () => void;
  onSelectWorkspaces: () => void;
  onSelectSession: (id: number | string) => void;
  onNewSessionForFolder: (folderId: number) => void;
  onNewWorktreeSession?: (folderId: number, worktreePath: string) => void;
  onToggleFolder: (folderId: number) => void;
  onToast: (message: string, type?: 'success' | 'error') => void;
  onStartSessionSelection: (folderId: number) => void;
  onCancelWait?: (waitId: string) => void;
}

export function ClassicDrawer({
  folders,
  initializing,
  activeSessionId,
  expandedFolders,
  sessionStatus,
  searchQuery,
  sortOption,
  optionsOpen,
  showArchived,
  optionsRef,
  scheduledCount,
  refreshing,
  selecting,
  batch,
  onNewSession,
  onNewWorkspace,
  onScheduler,
  onRefresh,
  onToggleOptions,
  onSortChange,
  onResetSort,
  onToggleArchived,
  onHideArchived,
  onSearchChange,
  onClearSearch,
  onSelectWorkspaces,
  onSelectSession,
  onNewSessionForFolder,
  onNewWorktreeSession,
  onToggleFolder,
  onToast,
  onStartSessionSelection,
  onCancelWait,
}: ClassicDrawerProps) {
  return (
    <>
      <MobileSessionToolbar
        searchQuery={searchQuery}
        sortOption={sortOption}
        optionsOpen={optionsOpen}
        showArchived={showArchived}
        optionsRef={optionsRef}
        onNewSession={onNewSession}
        onNewWorkspace={onNewWorkspace}
        onScheduler={onScheduler}
        scheduledCount={scheduledCount}
        onRefresh={onRefresh}
        refreshing={refreshing}
        onToggleOptions={onToggleOptions}
        onSortChange={onSortChange}
        onResetSort={onResetSort}
        onToggleArchived={onToggleArchived}
        onHideArchived={onHideArchived}
        onSearchChange={onSearchChange}
        onClearSearch={onClearSearch}
        onSelectWorkspaces={onSelectWorkspaces}
        selecting={selecting}
      />

      {initializing ? (
        <MobileSessionListSkeleton />
      ) : (
        <MobileSessionList
          folders={folders}
          activeSessionId={activeSessionId}
          expandedFolders={expandedFolders}
          showArchived={showArchived}
          sessionStatus={sessionStatus}
          onSelectSession={onSelectSession}
          onNewSessionForFolder={onNewSessionForFolder}
          onNewWorktreeSession={onNewWorktreeSession}
          onToggleFolder={onToggleFolder}
          onToast={onToast}
          batch={batch}
          onStartSessionSelection={onStartSessionSelection}
          onCancelWait={onCancelWait}
        />
      )}
    </>
  );
}
