import { useEffect, useRef, useState } from 'preact/hooks';
import { MobileSessionHeader } from '@/client/components/mobile/mobile-session-sidebar/Header';
import { MobileSessionToolbar } from '@/client/components/mobile/mobile-session-sidebar/Toolbar';
import { MobileSessionList } from '@/client/components/mobile/mobile-session-sidebar/List';
import { MobileSessionFooter } from '@/client/components/mobile/mobile-session-sidebar/Footer';
import { useShellOffer } from '@/client/hooks/ui/updates/shell-download';
import { useOnClickOutside } from '@/client/hooks/ui/on-click-outside';
import { useKabmoEvent } from '@/client/hooks/ui/window-event';
import { useToasts } from '@/client/hooks/ui/toasts';
import { useCancelWait } from '@/client/hooks/chat/waiting/cancel';
import { useWaitingDispatch } from '@/client/hooks/chat/waiting/dispatch';
import { useUpdates } from '@/client/hooks/ui/updates';
import { UPDATE_REQUEST_EVENT } from '@/shared/lib/updates/popup-state';
import { useSessionSidebarController } from '@/client/hooks/chat/omp/session-sidebar-controller';
import { useScheduledTaskCount } from '@/client/hooks/workspace/scheduled-tasks';
import { MobileSessionListSkeleton } from '@/client/components/mobile/mobile-session-sidebar/Skeleton';
import { useBatchSelection } from '@/client/hooks/workspace/batch-selection';
import { useBatchDeleteRun } from '@/client/hooks/workspace/batch-delete-run';
import { phoneLeftStripVisible } from '@/shared/lib/workspace/mobile-dock';
import { dockBodyProps, useMobileDock } from '@/client/components/mobile/mobile-session-sidebar/use-dock';
import { MobileDockBody, MobileDockStrip } from '@/client/components/mobile/mobile-session-sidebar/Dock';
import { MobileDrawerDialogs } from '@/client/components/mobile/mobile-session-sidebar/Dialogs';
import { BatchActionBar } from '@/client/components/common/batch-selection/BatchActionBar';
import type { BatchBinding } from '@/client/components/common/batch-selection/types';
import { liveSelection, selectableSessionIds } from '@/shared/lib/workspace/batch-select';

interface MobileSessionSidebarProps {
  activeSessionId: number | string | null;
  onSelectSession: (id: number | string) => void;
  onNewSession: () => void;
  onNewSessionForFolder: (folderId: number) => void;
  /** Start a chat in a worktree made from this folder. */
  onNewWorktreeSession?: (folderId: number, worktreePath: string) => void;
  onClose: () => void;
  onDesktopToggle?: () => void;
  appSettings?: Record<string, any>;
  /** The active workspace's root, for a plugin panel placed on the dock. */
  rootPath?: string;
  /** Bumped after a write so a placed panel re-reads, like the right drawer. */
  refreshKey?: number;
  onRefresh?: () => void;
  onOpenFile?: (file: unknown) => void;
}

export function MobileSessionSidebar({
  activeSessionId,
  onSelectSession,
  onNewSession,
  onNewSessionForFolder,
  onNewWorktreeSession,
  onClose,
  onDesktopToggle,
  appSettings = {},
  rootPath,
  refreshKey = 0,
  onRefresh,
  onOpenFile,
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
  // An update inside a native shell, an install on an Android browser, nothing
  // elsewhere — see `useShellOffer`.
  const shellDownload = useShellOffer();
  const { toasts, pushToast, dismissToast } = useToasts();
  const cancelWait = useCancelWait(pushToast);
  useWaitingDispatch({ onNotice: pushToast });

  // The popup's "Update now" hands the run over rather than starting its own —
  // see the desktop sidebar. The phone must also bring the drawer forward, or
  // the About modal would open over the chat with the user still looking at the
  // session list they came from.
  useKabmoEvent(UPDATE_REQUEST_EVENT, () => {
    onClose();
    setAboutOpen(true);
    void updates.apply('kabmo').then((result) => {
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

  // Seeded from the list the drawer RENDERS, not from the raw server payload:
  // the controller force-opens a folder that hosts a pending row (a chat whose
  // transcript omp has not written yet), and a seed taken from the raw folders
  // would collapse it again — hiding the one row the user cannot get back by
  // expanding, because nothing else knows it exists.
  //
  // Keyed on the flags themselves rather than the array: `processedFolders` is
  // a new array on every sidebar push (a tool call republishes the structure),
  // and re-seeding on identity would discard every expansion the user just
  // made, several times a minute.
  const expansionSeed = processedFolders.map(folder => `${folder.id}:${folder.isExpanded}`).join('|');
  useEffect(() => {
    setExpandedFolders(Object.fromEntries(processedFolders.map(folder => [folder.id, folder.isExpanded])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expansionSeed]);

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

  // The Archive button is a sibling of the sort dropdown, not a row inside it,
  // so this no longer has to dismiss the dropdown itself — clicking anywhere
  // outside the menu does that already (`useOnClickOutside` below), and doing
  // it here as well would be a second answer to the same question.
  const handleToggleArchived = () => {
    setShowArchived(!showArchived);
  };

  // Batch selection — same two modes and the same rules as the desktop sidebar
  // (the state machine and the confirmation are shared hooks/components).
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
  // Same rule as the desktop sidebar: the count and the payload are the LIVE
  // selection, so a row removed elsewhere cannot be counted or sent.
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

  const dock = useMobileDock();
  const showingSessions = dock.showingSessions;
  const activeView = dock.activeView;
  const dockBody = dockBodyProps({
    sessionId: activeSessionId,
    refreshKey,
    rootPath,
    onRefresh,
    onOpenFile,
    onClose,
  });

  return (
    <div className="flex flex-col h-full w-full bg-canvas text-ink relative select-none">

      <MobileSessionHeader
        onClose={onClose}
        viewLabel={showingSessions ? 'Sessions' : dock.activePanel?.label ?? 'Panel'}
      />

      {/* The strip is the phone's RAIL, so it follows the switch: with the rail
          on it always draws, exactly like the desktop column's rail (which
          always holds Sessions). Requiring a second destination made the
          Settings switch a no-op on a phone with nothing placed. */}
      {phoneLeftStripVisible(dock.enabled) ? (
        <MobileDockStrip panels={dock.catalog} activeId={activeView} onSelect={dock.setActiveView} />
      ) : null}

      {/* The list is HIDDEN, never unmounted, while a panel is on screen — the
          same rule the desktop dock follows (`LeftDockView`): its folder
          expansion, scroll position and batch selection must survive a look at
          another view, and a re-mount would also re-seed every expansion from
          the server's flags. */}
      <div className={showingSessions ? 'contents' : 'hidden'}>
        <>
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
            onSelectWorkspaces={startWorkspaceSelection}
            selecting={batch.mode !== null}
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
              onNewWorktreeSession={
                onNewWorktreeSession
                  ? (id, path) => { onNewWorktreeSession(id, path); onClose(); }
                  : undefined
              }
              onToggleFolder={toggleFolder}
              onToast={pushToast}
              batch={batchBinding}
              onStartSessionSelection={(folderId) => batch.begin('session', folderId)}
              onCancelWait={cancelWait}
            />
          )}

          {batch.mode && (
            <BatchActionBar
              drawer
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
        </>
      </div>
      {showingSessions ? null : (
        <MobileDockBody panelKey={activeView} panel={dock.activePanel} body={dockBody} />
      )}

      <MobileSessionFooter
        onSettings={() => window.dispatchEvent(new CustomEvent('omp:open-settings', { detail: {} }))}
        onAbout={() => setAboutOpen(true)}
        shellDownload={shellDownload}
        onDesktopToggle={onDesktopToggle}
        updateAvailable={updates.hasUpdate}
        onUpdateClick={() => {
          setAboutOpen(true);
          void updates.check();
        }}
      />

      <MobileDrawerDialogs
        activeSessionId={activeSessionId}
        newWorkspaceOpen={newWorkspaceOpen}
        onCloseNewWorkspace={() => setNewWorkspaceOpen(false)}
        schedulerOpen={schedulerOpen}
        onCloseScheduler={() => setSchedulerOpen(false)}
        aboutOpen={aboutOpen}
        onCloseAbout={() => setAboutOpen(false)}
        updates={updates}
        pushToast={pushToast}
        batchDelete={batchDelete}
        batchMode={batch.mode}
        onEndBatch={batch.end}
        scopeLabel={scopeFolder?.name}
        toasts={toasts}
        dismissToast={dismissToast}
      />

    </div>
  );
}
