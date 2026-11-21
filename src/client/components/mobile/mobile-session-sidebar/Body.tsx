/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The phone left drawer's VIEW STACK — the list, the batch bar, and a placed
 * panel's body.
 *
 * Extracted from `SessionSidebar` when that file crossed the 350-line ceiling,
 * and the split is by question: the drawer owns the controller, the dialogs and
 * the chrome; this owns the one node the chrome draws. It exists as a component
 * rather than inline JSX because the SAME node is used by both chromes — under
 * `classic` it sits below the chip row, under `tabs` it is `PanelTabsColumn`'s
 * body — and a second copy per mode is how one of them would lose the mounted
 * session list (its folder expansion, scroll position and batch selection).
 *
 * Two rules, both inherited from the desktop dock (`LeftDockView`):
 *
 * - **The session list is hidden, never unmounted**, while a placed panel is on
 *   screen. A re-mount would re-seed every folder expansion from the server.
 * - **A placed panel's body is drawn only while it is the view on screen.**
 */

import { ClassicDrawer } from '@/client/components/mobile/mobile-session-sidebar/ClassicDrawer';
import { ModernSidebarView } from '@/client/components/layout/session-sidebar/modern';
import { MobileDockBody } from '@/client/components/mobile/mobile-session-sidebar/Dock';
import { BatchActionBar } from '@/client/components/common/batch-selection/BatchActionBar';
import type { SessionSidebarVariantProps } from '@/client/components/layout/session-sidebar/variant-props';
import type { ToastTone } from '@/shared/lib/ui/toast-duration';
import type { DrawerState } from '@/client/components/mobile/mobile-session-sidebar/use-drawer';

export interface DrawerBodyProps {
  sidebarStyle: 'classic' | 'modern';
  controller: DrawerState['controller'];
  batch: DrawerState['batch'];
  dock: DrawerState['dock'];
  dockBody: DrawerState['dockBody'];
  expandedFolders: DrawerState['expandedFolders'];
  optionsRef: DrawerState['optionsRef'];
  activeSessionId: number | string | null;
  scheduledCount: number;
  onToggleFolder: (folderId: number) => void;
  onNewSession: () => void;
  onNewWorkspace: () => void;
  onScheduler: () => void;
  onToggleArchived: () => void;
  onNewSessionForFolder: (folderId: number) => void;
  onNewWorktreeSession?: (folderId: number, worktreePath: string) => void;
  onToast: (message: string, tone?: ToastTone) => void;
  onArchiveSelected: () => void;
  onCancelWait: (waitId: string) => void;
}

export function DrawerBody({
  sidebarStyle,
  controller,
  batch,
  dock,
  dockBody,
  expandedFolders,
  optionsRef,
  activeSessionId,
  scheduledCount,
  onToggleFolder,
  onNewSession,
  onNewWorkspace,
  onScheduler,
  onToggleArchived,
  onNewSessionForFolder,
  onNewWorktreeSession,
  onToast,
  onArchiveSelected,
  onCancelWait,
}: DrawerBodyProps) {
  const {
    initializing,
    failed,
    refreshNow,
    isRefreshing,
    searchQuery,
    setSearchQuery,
    showArchived,
    setShowArchived,
    optionsOpen,
    setOptionsOpen,
    sortOption,
    handleSortChange,
    harnessFilter,
    setHarnessFilter,
    harnessOptions,
    processedFolders,
    sessionStatus,
    handleSelectSession,
  } = controller;
  const { selection, deleteRun, archiveRun, binding: batchBinding, scopeFolder, available, selected } = batch;

  /**
   * The same contract the desktop dispatcher hands its two styles, so the phone
   * and the desktop cannot describe a folder, a row or an action differently.
   *
   * Built HERE rather than by the drawer: every field is derived from the
   * controller and the props this component already has, and the drawer that
   * only forwards them is a second place for the two to disagree.
   */
  const modernProps: SessionSidebarVariantProps = {
    // Fills the drawer between the header and the batch bar, the same way the
    // desktop dispatcher sizes its chrome.
    className: 'flex-1 min-h-0 w-full',
    folders: processedFolders,
    initializing,
    failed,
    activeSessionId,
    sessionStatus,
    searchQuery,
    onSearchChange: setSearchQuery,
    showArchived,
    onToggleArchived: onToggleArchived,
    sortOption,
    optionsOpen,
    onToggleOptions: () => setOptionsOpen(!optionsOpen),
    onCloseOptions: () => setOptionsOpen(false),
    onSortChange: handleSortChange,
    harnessFilter,
    onHarnessFilterChange: setHarnessFilter,
    harnessOptions,
    onRefresh: refreshNow,
    refreshing: isRefreshing,
    scheduledCount,
    onNewSession,
    onNewWorkspace,
    onScheduler,
    onSelectSession: handleSelectSession,
    onNewSessionForFolder,
    onNewWorktreeSession,
    onToast,
    onCancelWait,
    batch: batchBinding,
    onSelectWorkspaces: batch.toggleWorkspaceSelection,
    onStartSessionSelection: (folderId) => selection.begin('session', folderId),
  };

  return (
    <>
      <div className={dock.showingSessions ? 'contents' : 'hidden'}>
        {sidebarStyle === 'modern' ? (
          <ModernSidebarView {...modernProps} touch />
        ) : (
          <ClassicDrawer
            folders={processedFolders}
            initializing={initializing}
            failed={failed}
            activeSessionId={activeSessionId}
            expandedFolders={expandedFolders}
            sessionStatus={sessionStatus}
            searchQuery={searchQuery}
            sortOption={sortOption}
            optionsOpen={optionsOpen}
            showArchived={showArchived}
            harnessFilter={harnessFilter}
            onHarnessFilterChange={setHarnessFilter}
            harnessOptions={harnessOptions}
            optionsRef={optionsRef}
            scheduledCount={scheduledCount}
            refreshing={isRefreshing}
            selecting={selection.mode !== null}
            batch={batchBinding}
            onNewSession={onNewSession}
            onNewWorkspace={onNewWorkspace}
            onScheduler={onScheduler}
            onRefresh={refreshNow}
            onToggleOptions={() => setOptionsOpen(!optionsOpen)}
            onSortChange={handleSortChange}
            onResetSort={() => handleSortChange('A-Z')}
            onToggleArchived={onToggleArchived}
            onHideArchived={() => setShowArchived(false)}
            onSearchChange={setSearchQuery}
            onClearSearch={() => setSearchQuery('')}
            onSelectWorkspaces={batch.toggleWorkspaceSelection}
            onSelectSession={handleSelectSession}
            onNewSessionForFolder={onNewSessionForFolder}
            onNewWorktreeSession={onNewWorktreeSession}
            onToggleFolder={onToggleFolder}
            onToast={onToast}
            onStartSessionSelection={(folderId) => selection.begin('session', folderId)}
            onCancelWait={onCancelWait}
          />
        )}

        {selection.mode && (
          <BatchActionBar
            drawer
            mode={selection.mode}
            count={selected.length}
            total={available.length}
            busy={deleteRun.isDeleting}
            archiving={archiveRun.isArchiving}
            scopeLabel={scopeFolder?.name}
            onSelectAll={() => selection.selectAllOf(available)}
            onUnselectAll={() => selection.unselectAllOf(available)}
            onDelete={() => deleteRun.request(selected)}
            onArchive={onArchiveSelected}
            onCancel={selection.end}
          />
        )}
      </div>
      {dock.showingSessions ? null : (
        <MobileDockBody panelKey={dock.activeView} panel={dock.activePanel} body={dockBody} />
      )}
    </>
  );
}
