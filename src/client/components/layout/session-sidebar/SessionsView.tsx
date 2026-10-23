import { useState } from 'preact/hooks';
import { useSearchParams } from '@/client/lib/router/search-params';
import { NewWorkspaceModal } from '@/client/components/layout/session-sidebar/Modals';
import { SchedulerModal } from '@/client/components/layout/session-sidebar/scheduler-modal';
import { SessionSidebarToolbar } from '@/client/components/layout/session-sidebar/Toolbar';
import { SessionSidebarSessionList } from '@/client/components/layout/session-sidebar/SessionList';
import { SessionListSkeleton } from '@/client/components/layout/session-sidebar/Skeleton';
import { ToastStack } from '@/client/components/common/ToastStack';
import { spawnCwdForNewSession, triggerSessionPrewarm } from '@/shared/lib/omp/session/prewarm';
import { useToasts } from '@/client/hooks/ui/toasts';
import { useSessionSidebarController } from '@/client/hooks/chat/omp/session-sidebar-controller';
import { useCancelWait } from '@/client/hooks/chat/waiting/cancel';
import { useWaitingDispatch } from '@/client/hooks/chat/waiting/dispatch';
import { startPendingSession } from '@/client/hooks/chat/omp/pending-sessions';
import { setSessionKey } from '@/shared/lib/workspace/session-state/store';
import { useScheduledTaskCount } from '@/client/hooks/workspace/scheduled-tasks';
import { cloneWorkspaceFolder, createWorkspaceFolder } from '@/client/hooks/workspace/new-workspace';
import { useBatchSelection } from '@/client/hooks/workspace/batch-selection';
import { useBatchDeleteRun } from '@/client/hooks/workspace/batch-delete-run';
import { BatchActionBar } from '@/client/components/common/batch-selection/BatchActionBar';
import { BatchDeleteModal } from '@/client/components/common/batch-selection/BatchDeleteModal';
import type { BatchBinding } from '@/client/components/common/batch-selection/types';
import { liveSelection, selectableSessionIds } from '@/shared/lib/workspace/batch-select';

/**
 * The session list — the left dock's own view.
 *
 * It used to BE the left column. The column is a dock now, and this is the view
 * that fills it unless the user places a plugin panel there; the strip below it
 * (Settings · About · the APK offer) is the DOCK's, not this view's, because
 * those controls act on Kabmo rather than on the list.
 *
 * Three things are deliberately NOT here any more:
 *
 * - **The header.** It is the COLUMN's title row now, and it spans the rail too
 *   (see `LeftColumn`): a title that stopped at the dock body would leave the
 *   rail starting above it, with a gap under the app's own titlebar.
 * - **The footer.** It is dock furniture, and a plugin view on the same dock
 *   must not take it away — moving to a plugin panel would otherwise lose the
 *   only visible way into Settings.
 * - **The update popup and the About modal it hands over to.** Both are app
 *   level: they are about the console, not about one view, and the dock renders
 *   them so they survive a view switch.
 *
 * Everything else — the header's collapse control, the toolbar, the batch bar,
 * the workspace and scheduler dialogs — belongs to the list and stays.
 */
export function SessionsView({
  className = '',
  appSettings = {},
}: {
  className?: string;
  appSettings?: Record<string, any>;
}) {
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

  const [newWorkspaceOpen, setNewWorkspaceOpen] = useState(false);
  const [schedulerOpen, setSchedulerOpen] = useState(false);
  const scheduledCount = useScheduledTaskCount();
  const { toasts, pushToast, dismissToast } = useToasts();
  const cancelWait = useCancelWait(pushToast);
  // Follows a held prompt to its session — in whichever tab or instance sent it.
  useWaitingDispatch({ onNotice: pushToast });

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
      // The folder the chat will run in: the active session's, else the one the
      // URL already names. Dropping the URL's own `folderId` (the previous
      // `else next.delete`) left a chat opened with `?folderId=` with NO context
      // — its composer then stayed disabled ("Please select a workspace above")
      // and the first send never happened.
      const contextFolderId = currentFolder?.id ?? (prev.get('folderId') ? Number(prev.get('folderId')) : null);
      next.set('sessionId', startPendingSession(contextFolderId));
      if (contextFolderId != null) next.set('folderId', String(contextFolderId));
      else next.delete('folderId');
      return next;
    }, { replace: true });
  };

  /**
   * Start a chat in a worktree made from this folder.
   *
   * The pick is written into the PENDING session's own state before the URL
   * names it, so the composer's target picker draws it and the send path reads
   * it through its ref — the same key the picker writes. Starting the chat here
   * rather than only reporting the folder is what makes the entry point useful:
   * a worktree created from the sidebar with no chat in it is a folder the user
   * then has to go and find.
   */
  const handleNewWorktreeSession = (folderId: number, worktreePath: string) => {
    prewarmForNewSession(folderId);
    const pendingId = startPendingSession(folderId);
    setSessionKey(pendingId, 'chat.spawnTarget', { folderId, worktreePath });
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('sessionId', pendingId);
      next.set('folderId', folderId.toString());
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
      <div className={`flex flex-col h-full ${className}`}>
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
            onNewWorktreeSession={handleNewWorktreeSession}
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
      </div>

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
