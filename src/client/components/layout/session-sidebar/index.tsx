import { useState } from 'preact/hooks';
import { useSearchParams } from '@/client/lib/router/search-params';
import { AboutModal, NewWorkspaceModal, SettingsModal } from '@/client/components/layout/session-sidebar/Modals';
import { SchedulerModal } from '@/client/components/layout/session-sidebar/scheduler-modal';
import { UpdatePopup } from '@/client/components/layout/update-popup';
import { SessionSidebarHeader } from '@/client/components/layout/session-sidebar/Header';
import { SessionSidebarToolbar } from '@/client/components/layout/session-sidebar/Toolbar';
import { SessionSidebarFooter } from '@/client/components/layout/session-sidebar/Footer';
import { SessionSidebarSessionList } from '@/client/components/layout/session-sidebar/SessionList';
import { SessionListSkeleton } from '@/client/components/layout/session-sidebar/Skeleton';
import { ToastStack } from '@/client/components/common/ToastStack';
import { spawnCwdForNewSession, triggerSessionPrewarm } from '@/shared/lib/omp/session/prewarm';
import { useChamberEvent } from '@/client/hooks/ui/window-event';
import { useToasts } from '@/client/hooks/ui/toasts';
import { useUpdates } from '@/client/hooks/ui/updates';
import { UPDATE_REQUEST_EVENT } from '@/shared/lib/updates/popup-state';
import { useSessionSidebarController } from '@/client/hooks/chat/omp/session-sidebar-controller';
import { useScheduledTaskCount } from '@/client/hooks/workspace/scheduled-tasks';
import { cloneWorkspaceFolder, createWorkspaceFolder } from '@/client/hooks/workspace/new-workspace';
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
  } = useSessionSidebarController(appSettings, { includePendingSessions: true });
  const [, setSearchParams] = useSearchParams();

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  // Modals for new workspace and scheduler
  const [newWorkspaceOpen, setNewWorkspaceOpen] = useState(false);
  const [schedulerOpen, setSchedulerOpen] = useState(false);
  const scheduledCount = useScheduledTaskCount();
  const updates = useUpdates();
  const { toasts, pushToast, dismissToast } = useToasts();

  // Sidebar inline states
  const [isSearchVisible, setIsSearchVisible] = useState(false);

  // The popup's "Update now" hands the run over instead of starting its own: the
  // About modal is where an update has always been driven from and it owns the
  // live output, so this opens it and starts the run it will draw. The popup
  // dispatches this only after it has closed, so the two dialogs never stack.
  useChamberEvent(UPDATE_REQUEST_EVENT, () => {
    setInfoOpen(true);
    void updates.apply('ompchamber').then((result) => {
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
      // Client-side pending session: shown immediately with a default title;
      // the real omp session id replaces it on first send.
      next.set('sessionId', `new-${Date.now()}`);
      if (currentSessionId) {
        const currentFolder = folders.find(f => f.sessions?.some((s: any) => String(s.id) === String(currentSessionId)));
        if (currentFolder) {
          next.set('folderId', currentFolder.id.toString());
        }
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
      next.set('sessionId', `new-${Date.now()}`);
      next.set('folderId', folderId.toString());
      return next;
    }, { replace: true });
  };

  return (
    <>
      <aside className={`flex flex-col bg-paper h-full ${className}`}>
        <SessionSidebarHeader onNewSession={handleNewSession} streamStatus={streamStatus} />

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
          onNewWorkspace={() => setNewWorkspaceOpen(true)}
          onScheduler={() => setSchedulerOpen(true)}
          scheduledCount={scheduledCount}
          onRefresh={refreshNow}
          refreshing={isRefreshing}
          onClose={onClose}
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
          />
        )}

        <SessionSidebarFooter
          onSettings={() => setSettingsOpen(true)}
          onInfo={() => setInfoOpen(true)}
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
