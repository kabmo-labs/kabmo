import { useState } from 'preact/hooks';
import { MobileSessionHeader } from '@/client/components/mobile/mobile-session-sidebar/Header';
import { ClassicDrawer } from '@/client/components/mobile/mobile-session-sidebar/ClassicDrawer';
import { ModernSidebarView } from '@/client/components/layout/session-sidebar/modern';
import { MobileSessionFooter } from '@/client/components/mobile/mobile-session-sidebar/Footer';
import { useShellOffer } from '@/client/hooks/ui/updates/shell-download';
import { useKabmoEvent } from '@/client/hooks/ui/window-event';
import { useToasts } from '@/client/hooks/ui/toasts';
import { useCancelWait } from '@/client/hooks/chat/waiting/cancel';
import { useWaitingDispatch } from '@/client/hooks/chat/waiting/dispatch';
import { useUpdates } from '@/client/hooks/ui/updates';
import { useSidebarStyle } from '@/client/hooks/workspace/sidebar-style';
import { UPDATE_REQUEST_EVENT } from '@/shared/lib/updates/popup-state';
import { useScheduledTaskCount } from '@/client/hooks/workspace/scheduled-tasks';
import { phoneLeftStripVisible } from '@/shared/lib/workspace/mobile-dock';
import { MobileDockBody, MobileDockStrip } from '@/client/components/mobile/mobile-session-sidebar/Dock';
import { MobileDrawerDialogs } from '@/client/components/mobile/mobile-session-sidebar/Dialogs';
import { useDrawerState } from '@/client/components/mobile/mobile-session-sidebar/use-drawer';
import { archiveOutcomeMessage } from '@/client/hooks/workspace/batch-archive';
import { BatchActionBar } from '@/client/components/common/batch-selection/BatchActionBar';
import type { SessionSidebarVariantProps } from '@/client/components/layout/session-sidebar/variant-props';

/**
 * The phone's session drawer — the dispatcher, exactly like the desktop
 * `SessionsView`.
 *
 * It owns the controller, the folder expansion, the batch machine and the
 * dialogs; two chromes draw the list. `classic` is the drawer that shipped
 * before the style setting (`ClassicDrawer`), `modern` is the same
 * `ModernSidebarView` the desktop dock uses with `touch` density — NOT a second
 * phone implementation, so a row drawn here and a row drawn on a desktop are
 * the same component at two sizes.
 *
 * Two rules the drawer carries into both styles:
 *
 * - **The list is hidden, never unmounted, while a placed panel is on screen**
 *   (the same rule the desktop dock follows): its folder expansion, scroll
 *   position and batch selection must survive a look at another view, and a
 *   re-mount would re-seed every expansion from the server's flags.
 * - **New Session closes the drawer.** The pending chat is opened behind it, so
 *   the user lands on the chat rather than on the list they just acted on.
 */
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
  const { controller, batch, expandedFolders, toggleFolder, optionsRef, dock, dockBody } = useDrawerState({
    appSettings,
    onSelectSession,
    onClose,
    rootPath,
    refreshKey,
    onRefresh,
    onOpenFile,
  });
  const {
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
  } = controller;
  const { selection, deleteRun, archiveRun, binding: batchBinding, scopeFolder, available, selected } = batch;
  const sidebarStyle = useSidebarStyle();

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

  const handleNewSessionAndClose = () => {
    onNewSession();
    onClose();
  };

  // Archive the selection — the same reversible flow the desktop dispatcher
  // runs: no confirmation, one toast, leave the mode once the rows have moved
  // to the archive view. A request-level error keeps the selection to retry.
  const handleArchiveSelected = () => {
    void archiveRun.archive(selected).then((result) => {
      if (!result) return;
      const report = archiveOutcomeMessage(result);
      if (report) pushToast(report.message, report.tone);
      if (!result.error) selection.end();
    });
  };

  // Same dismissal as the toolbar's New Session: the pending session is opened
  // behind the drawer, so the user must land on the chat, not on the list.
  const handleNewSessionForFolderAndClose = (folderId: number) => {
    onNewSessionForFolder(folderId);
    onClose();
  };

  // The Archive control is a sibling of the sort dropdown, not a row inside it,
  // so this no longer has to dismiss the dropdown itself — clicking anywhere
  // outside the menu does that already, and doing it here as well would be a
  // second answer to the same question.
  const handleToggleArchived = () => {
    setShowArchived(!showArchived);
  };

  const closeAfterWorktree = onNewWorktreeSession
    ? (id: number, path: string) => {
        onNewWorktreeSession(id, path);
        onClose();
      }
    : undefined;

  // The same contract the desktop dispatcher hands its two styles, so the phone
  // and the desktop cannot describe a folder, a row or an action differently.
  const modernProps: SessionSidebarVariantProps = {
    // Fills the drawer between the header and the batch bar, the same way the
    // desktop dispatcher sizes its chrome.
    className: 'flex-1 min-h-0 w-full',
    folders: processedFolders,
    initializing,
    activeSessionId,
    sessionStatus,
    searchQuery,
    onSearchChange: setSearchQuery,
    showArchived,
    onToggleArchived: handleToggleArchived,
    sortOption,
    optionsOpen,
    onToggleOptions: () => setOptionsOpen(!optionsOpen),
    onCloseOptions: () => setOptionsOpen(false),
    onSortChange: handleSortChange,
    onRefresh: refreshNow,
    refreshing: isRefreshing,
    scheduledCount,
    onNewSession: handleNewSessionAndClose,
    onNewWorkspace: () => setNewWorkspaceOpen(true),
    onScheduler: () => setSchedulerOpen(true),
    onSelectSession: handleSelectSession,
    onNewSessionForFolder: handleNewSessionForFolderAndClose,
    onNewWorktreeSession: closeAfterWorktree,
    onToast: pushToast,
    onCancelWait: cancelWait,
    batch: batchBinding,
    onSelectWorkspaces: batch.toggleWorkspaceSelection,
    onStartSessionSelection: (folderId) => selection.begin('session', folderId),
  };

  return (
    <div className="flex flex-col h-full w-full bg-canvas text-ink relative select-none">

      <MobileSessionHeader
        onClose={onClose}
        viewLabel={dock.showingSessions ? 'Sessions' : dock.activePanel?.label ?? 'Panel'}
      />

      {/* The strip is the phone's RAIL, so it follows the switch: with the rail
          on it always draws, exactly like the desktop column's rail (which
          always holds Sessions). Requiring a second destination made the
          Settings switch a no-op on a phone with nothing placed. */}
      {phoneLeftStripVisible(dock.enabled) ? (
        <MobileDockStrip panels={dock.catalog} activeId={dock.activeView} onSelect={dock.setActiveView} />
      ) : null}

      {/* The list is HIDDEN, never unmounted, while a panel is on screen — the
          same rule the desktop dock follows (`LeftDockView`): its folder
          expansion, scroll position and batch selection must survive a look at
          another view, and a re-mount would also re-seed every expansion from
          the server's flags. */}
      <div className={dock.showingSessions ? 'contents' : 'hidden'}>
        {sidebarStyle === 'modern' ? (
          <ModernSidebarView {...modernProps} touch />
        ) : (
          <ClassicDrawer
            folders={processedFolders}
            initializing={initializing}
            activeSessionId={activeSessionId}
            expandedFolders={expandedFolders}
            sessionStatus={sessionStatus}
            searchQuery={searchQuery}
            sortOption={sortOption}
            optionsOpen={optionsOpen}
            showArchived={showArchived}
            optionsRef={optionsRef}
            scheduledCount={scheduledCount}
            refreshing={isRefreshing}
            selecting={selection.mode !== null}
            batch={batchBinding}
            onNewSession={handleNewSessionAndClose}
            onNewWorkspace={() => setNewWorkspaceOpen(true)}
            onScheduler={() => setSchedulerOpen(true)}
            onRefresh={refreshNow}
            onToggleOptions={() => setOptionsOpen(!optionsOpen)}
            onSortChange={handleSortChange}
            onResetSort={() => handleSortChange('A-Z')}
            onToggleArchived={handleToggleArchived}
            onHideArchived={() => setShowArchived(false)}
            onSearchChange={setSearchQuery}
            onClearSearch={() => setSearchQuery('')}
            onSelectWorkspaces={batch.toggleWorkspaceSelection}
            onSelectSession={handleSelectSession}
            onNewSessionForFolder={handleNewSessionForFolderAndClose}
            onNewWorktreeSession={closeAfterWorktree}
            onToggleFolder={toggleFolder}
            onToast={pushToast}
            onStartSessionSelection={(folderId) => selection.begin('session', folderId)}
            onCancelWait={cancelWait}
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
            onArchive={handleArchiveSelected}
            onCancel={selection.end}
          />
        )}
      </div>
      {dock.showingSessions ? null : (
        <MobileDockBody panelKey={dock.activeView} panel={dock.activePanel} body={dockBody} />
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
        batchDelete={deleteRun}
        batchMode={selection.mode}
        onEndBatch={selection.end}
        scopeLabel={scopeFolder?.name}
        toasts={toasts}
        dismissToast={dismissToast}
      />

    </div>
  );
}
