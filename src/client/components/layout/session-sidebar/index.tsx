import { useState } from 'preact/hooks';
import { useSearchParams } from '@/client/lib/router/search-params';
import { AboutModal, NewWorkspaceModal, SettingsModal } from '@/client/components/layout/session-sidebar/Modals';
import { SchedulerModal } from '@/client/components/layout/session-sidebar/scheduler-modal';
import { UpdatePopup } from '@/client/components/layout/update-popup';
import { SessionSidebarHeader } from '@/client/components/layout/session-sidebar/Header';
import { SessionSidebarToolbar } from '@/client/components/layout/session-sidebar/Toolbar';
import { SessionSidebarFooter } from '@/client/components/layout/session-sidebar/Footer';
import { useAndroidDownload } from '@/client/hooks/ui/updates/android-download';
import { SessionSidebarSessionList } from '@/client/components/layout/session-sidebar/SessionList';
import { SessionListSkeleton } from '@/client/components/layout/session-sidebar/Skeleton';
import { ToastStack } from '@/client/components/common/ToastStack';
import { spawnCwdForNewSession, triggerSessionPrewarm } from '@/shared/lib/omp/session/prewarm';
import { useKabmoEvent } from '@/client/hooks/ui/window-event';
import { useToasts } from '@/client/hooks/ui/toasts';
import { useUpdates } from '@/client/hooks/ui/updates';
import { UPDATE_REQUEST_EVENT } from '@/shared/lib/updates/popup-state';
import { useSessionSidebarController } from '@/client/hooks/chat/omp/session-sidebar-controller';
import { useCancelWait } from '@/client/hooks/chat/waiting/cancel';
import { useWaitingDispatch } from '@/client/hooks/chat/waiting/dispatch';
import { startPendingSession } from '@/client/hooks/chat/omp/pending-sessions';
import { useScheduledTaskCount } from '@/client/hooks/workspace/scheduled-tasks';
import { cloneWorkspaceFolder, createWorkspaceFolder } from '@/client/hooks/workspace/new-workspace';
import { useBatchSelection } from '@/client/hooks/workspace/batch-selection';
import { useBatchDeleteRun } from '@/client/hooks/workspace/batch-delete-run';
import { BatchActionBar } from '@/client/components/common/batch-selection/BatchActionBar';
import { BatchDeleteModal } from '@/client/components/common/batch-selection/BatchDeleteModal';
import type { BatchBinding } from '@/client/components/common/batch-selection/types';
import { liveSelection, selectableSessionIds } from '@/shared/lib/workspace/batch-select';
import type { AgentStreamStatus } from '@/shared/lib/chat/omp/status';

export function SessionSidebar({ className = '', onClose, appSettings = {}, streamStatus }: { className?: string, onClose?: () => void, appSettings?: Record<string, any>, streamStatus?: AgentStreamStatus }) {
  const {
    folders,
    initializing,
    refreshNow,
    isRefreshing,
    activeSessionId,
    sessionParam,
    searchQuery,
    setSearchQuery,
    showArchived,
    setShowArchived,
    optionsOpen,
    setOptionsOpen,
    sortOption,
    handleSortChange,
    processedFolders,
    sessionStatus,
    handleSelectSession,
  } = useSessionSidebarController(appSettings, { expandSearchMatches: true });
  const [, setSearchParams] = useSearchParams();

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  // Modals for new workspace and scheduler
  const [newWorkspaceOpen, setNewWorkspaceOpen] = useState(false);
  const [schedulerOpen, setSchedulerOpen] = useState(false);
  const scheduledCount = useScheduledTaskCount();
  const updates = useUpdates();
  // The Android offer: an UPDATE inside the APK, an INSTALL on an Android
  // browser, and nothing anywhere else — see `useAndroidDownload`.
  const androidDownload = useAndroidDownload(
    window.__OMP_BOOTSTRAP__?.shellVersion,
    window.__OMP_BOOTSTRAP__?.isAndroid,
  );
  const { toasts, pushToast, dismissToast } = useToasts();
  const cancelWait = useCancelWait(pushToast);
  // Follows a held prompt to its session — in whichever tab or instance sent it.
  useWaitingDispatch({ onNotice: pushToast });

  // Sidebar inline states
  const [isSearchVisible, setIsSearchVisible] = useState(false);

  // Batch selection: two separate modes (sessions from a workspace's `⋯` menu,
  // workspaces from the toolbar). `batchDelete.pending` holds the ids the
  // confirmation dialog is about; the bar's Delete opens it and never deletes
  // on its own.
  const batch = useBatchSelection();
  const batchDelete = useBatchDeleteRun(refreshNow);

  const scopeFolder = batch.scopeFolderId === null
    ? null
    : processedFolders.find((folder) => folder.id === batch.scopeFolderId) ?? null;
  const batchAvailable = batch.mode === 'workspace'
    ? processedFolders.map((folder) => String(folder.id))
    : batch.mode === 'session'
      ? selectableSessionIds(scopeFolder?.sessions ?? [], showArchived)
      : [];
  // The count and the payload are the LIVE selection: an id that vanished from
  // the list (deleted in another tab, filtered away) is not something this bar
  // may still claim, and not something Delete may still send.
  const batchSelected = liveSelection(batch.selected, batchAvailable);

  const batchBinding: BatchBinding | undefined = batch.mode
    ? {
        mode: batch.mode,
        scopeFolderId: batch.scopeFolderId,
        selected: batch.selected,
        toggle: batch.toggle,
        selectAllOf: batch.selectAllOf,
        unselectAllOf: batch.unselectAllOf,
        summaryOf: batch.summaryOf,
      }
    : undefined;

  const startWorkspaceSelection = () => {
    if (batch.mode === 'workspace') batch.end();
    else batch.begin('workspace');
  };

  // The popup's "Update now" hands the run over instead of starting its own: the
  // About modal is where an update has always been driven from and it owns the
  // live output, so this opens it and starts the run it will draw. The popup
  // dispatches this only after it has closed, so the two dialogs never stack.
  useKabmoEvent(UPDATE_REQUEST_EVENT, () => {
    setInfoOpen(true);
    void updates.apply('kabmo').then((result) => {
      // A null result means the run was aborted with the page; there is nobody
      // left to tell. A `manual` answer is the command to run, not a success.
      if (!result) return;
      pushToast(result.message, result.success && !result.manual ? 'success' : 'error');
    });
  });

  /** The folder whose context a new session will inherit — same resolution
   *  the send path uses, so the prewarmed cwd matches the spawn cwd. */
  const prewarmForNewSession = (folderId?: number) => {
    const cwd = spawnCwdForNewSession(folders, sessionParam, folderId);
    if (cwd) triggerSessionPrewarm(cwd, appSettings.omp_access_mode);
  };

  const handleNewSession = () => {
    prewarmForNewSession();
    setSearchParams(prev => {
      const currentSessionId = prev.get('sessionId');
      const next = new URLSearchParams(prev);
      // The row this chat will show in the sidebar while omp has not written
      // its transcript yet. The store mints the id (and keeps the row), so the
      // URL carries what the sidebar reads rather than a second source.
      const currentFolder = currentSessionId
        ? folders.find(f => f.sessions?.some((s) => String(s.id) === String(currentSessionId)))
        : undefined;
      next.set('sessionId', startPendingSession(currentFolder?.id ?? null));
      if (currentFolder) {
        next.set('folderId', currentFolder.id.toString());
      } else {
        next.delete('folderId');
      }
      return next;
    }, { replace: true });
  };

  const handleNewSessionForFolder = (folderId: number) => {
    prewarmForNewSession(folderId);
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('sessionId', startPendingSession(folderId));
      next.set('folderId', folderId.toString());
      return next;
    }, { replace: true });
  };

  return (
    <>
      <aside className={`flex flex-col bg-paper h-full ${className}`}>
        <SessionSidebarHeader streamStatus={streamStatus} onCollapse={onClose} />

        <SessionSidebarToolbar
          isSearchVisible={isSearchVisible}
          searchQuery={searchQuery}
          showArchived={showArchived}
          optionsOpen={optionsOpen}
          sortOption={sortOption}
          onToggleSearch={() => setIsSearchVisible(!isSearchVisible)}
          onSearchChange={setSearchQuery}
          onToggleArchived={() => setShowArchived(!showArchived)}
          onHideArchived={() => setShowArchived(false)}
          onToggleOptions={() => setOptionsOpen(!optionsOpen)}
          onCloseOptions={() => setOptionsOpen(false)}
          onSortChange={handleSortChange}
          onNewSession={handleNewSession}
          onNewWorkspace={() => setNewWorkspaceOpen(true)}
          onScheduler={() => setSchedulerOpen(true)}
          scheduledCount={scheduledCount}
          onRefresh={refreshNow}
          refreshing={isRefreshing}
          onSelectWorkspaces={startWorkspaceSelection}
          selecting={batch.mode !== null}
        />

        {initializing ? (
          <SessionListSkeleton />
        ) : (
          <SessionSidebarSessionList
            folders={processedFolders}
            activeSessionId={activeSessionId}
            searchQuery={searchQuery}
            showArchived={showArchived}
            sessionStatus={sessionStatus}
            onSelectSession={handleSelectSession}
            onNewSessionForFolder={handleNewSessionForFolder}
            onToast={pushToast}
            batch={batchBinding}
            onStartSessionSelection={(folderId) => batch.begin('session', folderId)}
            onCancelWait={cancelWait}
          />
        )}

        {batch.mode && (
          <BatchActionBar
            mode={batch.mode}
            count={batchSelected.length}
            total={batchAvailable.length}
            busy={batchDelete.isDeleting}
            scopeLabel={scopeFolder?.name}
            onSelectAll={() => batch.selectAllOf(batchAvailable)}
            onUnselectAll={() => batch.unselectAllOf(batchAvailable)}
            onDelete={() => batchDelete.request(batchSelected)}
            onCancel={batch.end}
          />
        )}

        <SessionSidebarFooter
          onSettings={() => setSettingsOpen(true)}
          onInfo={() => setInfoOpen(true)}
          androidDownload={androidDownload}
          updateAvailable={updates.hasUpdate}
          onUpdateClick={() => {
            setInfoOpen(true);
            void updates.check();
          }}
        />
      </aside>

      {/* Settings Modal */}
      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} appSettings={appSettings} />

      {/* Info Modal */}
      <AboutModal
        isOpen={infoOpen}
        onClose={() => setInfoOpen(false)}
        updates={updates}
        onToast={pushToast}
      />

      {/* "Update available" announcement — once per version, gated on the check.
          Its "Update now" hands the run to the About modal below. */}
      <UpdatePopup updates={updates} />

      {/* Batch delete confirmation. It stays open on a refusal so the reasons
          can be read; a fully successful run closes itself and leaves the mode. */}
      <BatchDeleteModal
        mode={batch.mode ?? 'session'}
        count={batchDelete.pending.length}
        scopeLabel={scopeFolder?.name}
        isDeleting={batchDelete.isDeleting}
        outcome={batchDelete.outcome}
        onClose={() => {
          // A run that finished cleanly also ends the mode; one that refused
          // ids keeps it, so the rows that survived are still selected for a
          // second attempt.
          const refusedCount = batchDelete.outcome?.refused.length ?? 0;
          batchDelete.cancel();
          if (batchDelete.outcome && refusedCount === 0) batch.end();
        }}
        onConfirm={() => {
          const mode = batch.mode ?? 'session';
          void batchDelete.confirm(mode).then((result) => {
            // A finished run leaves the mode; a refused one keeps it so the
            // remaining rows are still selectable for a second attempt.
            if (result && result.refused.length === 0) batch.end();
          });
        }}
      />

      {/* New Workspace Modal */}
      <NewWorkspaceModal
        isOpen={newWorkspaceOpen}
        onClose={() => setNewWorkspaceOpen(false)}
        onCreate={createWorkspaceFolder}
        onClone={cloneWorkspaceFolder}
      />

      {/* Scheduler Modal */}
      <SchedulerModal
        isOpen={schedulerOpen}
        onClose={() => setSchedulerOpen(false)}
        activeSessionId={typeof sessionParam === 'string' ? sessionParam : null}
        onToast={pushToast}
      />

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
