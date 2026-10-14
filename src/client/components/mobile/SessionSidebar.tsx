import { useEffect, useRef, useState } from 'preact/hooks';
import { MobileSessionHeader } from '@/client/components/mobile/mobile-session-sidebar/Header';
import { MobileSessionToolbar } from '@/client/components/mobile/mobile-session-sidebar/Toolbar';
import { MobileSessionList } from '@/client/components/mobile/mobile-session-sidebar/List';
import { MobileSessionFooter } from '@/client/components/mobile/mobile-session-sidebar/Footer';
import { ToastStack } from '@/client/components/common/ToastStack';
import { AboutModal, NewWorkspaceModal } from '@/client/components/layout/session-sidebar/Modals';
import { SchedulerModal } from '@/client/components/layout/session-sidebar/scheduler-modal';
import { UpdatePopup } from '@/client/components/layout/update-popup';
import { useOnClickOutside } from '@/client/hooks/ui/on-click-outside';
import { useChamberEvent } from '@/client/hooks/ui/window-event';
import { useToasts } from '@/client/hooks/ui/toasts';
import { useUpdates } from '@/client/hooks/ui/updates';
import { UPDATE_REQUEST_EVENT } from '@/shared/lib/updates/popup-state';
import { useSessionSidebarController } from '@/client/hooks/chat/omp/session-sidebar-controller';
import { useScheduledTaskCount } from '@/client/hooks/workspace/scheduled-tasks';
import { cloneWorkspaceFolder, createWorkspaceFolder } from '@/client/hooks/workspace/new-workspace';
import { MobileSessionListSkeleton } from '@/client/components/mobile/mobile-session-sidebar/Skeleton';

interface MobileSessionSidebarProps {
  activeSessionId: number | string | null;
  onSelectSession: (id: number | string) => void;
  onNewSession: () => void;
  onNewSessionForFolder: (folderId: number) => void;
  onClose: () => void;
  onDesktopToggle?: () => void;
  appSettings?: Record<string, any>;
}

export function MobileSessionSidebar({
  activeSessionId,
  onSelectSession,
  onNewSession,
  onNewSessionForFolder,
  onClose,
  onDesktopToggle,
  appSettings = {}
}: MobileSessionSidebarProps) {
  const {
    folders,
    initializing,
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
    processedFolders,
    sessionStatus,
    handleSelectSession,
  } = useSessionSidebarController(appSettings, { onSelectSession, onAfterSelect: onClose });

  const [expandedFolders, setExpandedFolders] = useState<Record<number, boolean>>({
    1: true,
    2: true,
    3: true
  });

  // Modals state (matching desktop)
  const [newWorkspaceOpen, setNewWorkspaceOpen] = useState(false);
  const [schedulerOpen, setSchedulerOpen] = useState(false);
  const scheduledCount = useScheduledTaskCount();
  const [aboutOpen, setAboutOpen] = useState(false);
  const updates = useUpdates();
  const { toasts, pushToast, dismissToast } = useToasts();

  // The popup's "Update now" hands the run over rather than starting its own —
  // see the desktop sidebar. The phone must also bring the drawer forward, or
  // the About modal would open over the chat with the user still looking at the
  // session list they came from.
  useChamberEvent(UPDATE_REQUEST_EVENT, () => {
    onClose();
    setAboutOpen(true);
    void updates.apply('ompchamber').then((result) => {
      if (!result) return;
      pushToast(result.message, result.success && !result.manual ? 'success' : 'error');
    });
  });

  const optionsRef = useRef<HTMLDivElement>(null);
  useOnClickOutside(optionsRef, () => setOptionsOpen(false));

  const toggleFolder = (folderId: number) => {
    setExpandedFolders(prev => ({
      ...prev,
      [folderId]: !prev[folderId]
    }));
    const folder = folders.find(item => item.id === folderId);
    const nextExpanded = !(expandedFolders[folderId] ?? folder?.isExpanded ?? true);
    fetch(`/api/folders/${folderId}/toggle`, {
      method: 'POST',
      body: new URLSearchParams({ isExpanded: String(nextExpanded) }),
    })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
      })
      .catch((error: unknown) => {
        console.error('Failed to save mobile workspace state:', error);
      });
  };

  useEffect(() => {
    setExpandedFolders(Object.fromEntries(folders.map(folder => [folder.id, folder.isExpanded])));
  }, [folders]);

  const handleNewSessionAndClose = () => {
    onNewSession();
    onClose();
  };

  // Same dismissal as the toolbar's New Session: the pending session is opened
  // behind the drawer, so the user must land on the chat, not on the list.
  const handleNewSessionForFolderAndClose = (folderId: number) => {
    onNewSessionForFolder(folderId);
    onClose();
  };

  const handleToggleArchived = () => {
    setShowArchived(!showArchived);
    setOptionsOpen(false);
  };

  return (
    <div className="flex flex-col h-full w-full bg-canvas text-ink relative select-none">
      
      <MobileSessionHeader onClose={onClose} />

      <MobileSessionToolbar
        searchQuery={searchQuery}
        sortOption={sortOption}
        optionsOpen={optionsOpen}
        showArchived={showArchived}
        optionsRef={optionsRef}
        onNewSession={handleNewSessionAndClose}
        onNewWorkspace={() => setNewWorkspaceOpen(true)}
        onScheduler={() => setSchedulerOpen(true)}
        scheduledCount={scheduledCount}
        onRefresh={refreshNow}
        refreshing={isRefreshing}
        onToggleOptions={() => setOptionsOpen(!optionsOpen)}
        onSortChange={handleSortChange}
        onResetSort={() => handleSortChange('A-Z')}
        onToggleArchived={handleToggleArchived}
        onHideArchived={() => setShowArchived(false)}
        onSearchChange={setSearchQuery}
        onClearSearch={() => setSearchQuery('')}
      />

      {initializing ? (
        <MobileSessionListSkeleton />
      ) : (
        <MobileSessionList
          folders={processedFolders}
          activeSessionId={activeSessionId}
          expandedFolders={expandedFolders}
          showArchived={showArchived}
          sessionStatus={sessionStatus}
          onSelectSession={handleSelectSession}
          onNewSessionForFolder={handleNewSessionForFolderAndClose}
          onToggleFolder={toggleFolder}
          onToast={pushToast}
        />
      )}

      <MobileSessionFooter
        onSettings={() => window.dispatchEvent(new CustomEvent('omp:open-settings', { detail: {} }))}
        onAbout={() => setAboutOpen(true)}
        onDesktopToggle={onDesktopToggle}
        updateAvailable={updates.hasUpdate}
        onUpdateClick={() => {
          setAboutOpen(true);
          void updates.check();
        }}
      />

      {/* Reusable Modals */}
      <NewWorkspaceModal
        isOpen={newWorkspaceOpen}
        onClose={() => setNewWorkspaceOpen(false)}
        onCreate={createWorkspaceFolder}
        onClone={cloneWorkspaceFolder}
      />
      <SchedulerModal
        isOpen={schedulerOpen}
        onClose={() => setSchedulerOpen(false)}
        activeSessionId={activeSessionId === null ? null : String(activeSessionId)}
        onToast={pushToast}
      />
      <AboutModal
        isOpen={aboutOpen}
        onClose={() => setAboutOpen(false)}
        updates={updates}
        onToast={pushToast}
      />

      {/* "Update available" announcement — once per version, gated on the check.
          Its "Update now" hands the run to the About modal below. */}
      <UpdatePopup updates={updates} />

      <ToastStack toasts={toasts} onDismiss={dismissToast} />

    </div>
  );
}
