import { useState } from 'preact/hooks';
import { useSearchParams } from '@/client/lib/router/search-params';
import { NewWorkspaceModal } from '@/client/components/layout/session-sidebar/Modals';
import { SchedulerModal } from '@/client/components/layout/session-sidebar/scheduler-modal';
import { ClassicSidebarView } from '@/client/components/layout/session-sidebar/ClassicView';
import { ModernSidebarView } from '@/client/components/layout/session-sidebar/modern';
import { ToastStack } from '@/client/components/common/ToastStack';
import { spawnCwdForNewSession, triggerSessionPrewarm } from '@/shared/lib/omp/session/prewarm';
import { useToasts } from '@/client/hooks/ui/toasts';
import { useSessionSidebarController } from '@/client/hooks/chat/omp/session-sidebar-controller';
import { useSidebarStyle } from '@/client/hooks/workspace/sidebar-style';
import { useCancelWait } from '@/client/hooks/chat/waiting/cancel';
import { useWaitingDispatch } from '@/client/hooks/chat/waiting/dispatch';
import { startPendingSession } from '@/client/hooks/chat/omp/pending-sessions';
import { setSessionKey } from '@/shared/lib/workspace/session-state/store';
import { useScheduledTaskCount } from '@/client/hooks/workspace/scheduled-tasks';
import { cloneWorkspaceFolder, createWorkspaceFolder } from '@/client/hooks/workspace/new-workspace';
import { useSidebarBatch } from '@/client/hooks/workspace/sidebar-batch';
import { archiveOutcomeMessage } from '@/client/hooks/workspace/batch-archive';
import { BatchActionBar } from '@/client/components/common/batch-selection/BatchActionBar';
import { BatchDeleteModal } from '@/client/components/common/batch-selection/BatchDeleteModal';
import type { SessionSidebarVariantProps } from '@/client/components/layout/session-sidebar/variant-props';

/**
 * The session list — the left dock's own view, and the ONE owner of its data.
 *
 * This file is a dispatcher, not a layout. It reads the controller, holds the
 * search/archive/sort state, runs the batch machine, and renders the dialogs
 * and toasts. Two chrome variants draw the result — `classic` (the layout Kabmo
 * shipped before the style setting) and `modern` — and each receives exactly
 * the same `SessionSidebarVariantProps`. That is the whole design: a style
 * chooses a frame, never a behaviour, so an action added here exists in both
 * and a style cannot grow a private copy of one.
 *
 * Three things are deliberately NOT here:
 *
 * - **The header.** It is the COLUMN's title row (`LeftColumn`), spanning the
 *   rail too: a title that stopped at the dock body would leave the rail
 *   starting above it, with a gap under the app's own titlebar.
 * - **The footer.** It is dock furniture, and a plugin view on the same dock
 *   must not take it away — moving to a plugin panel would otherwise lose the
 *   only visible way into Settings.
 * - **The update popup and the About modal it hands over to.** Both are app
 *   level, and the dock renders them so they survive a view switch.
 *
 * The batch bar is drawn HERE rather than inside a variant: it is the same bar
 * in both styles, and a style that owned it could forget to.
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
  // The style the user chose. Live: the settings modal announces a change and
  // this subscription redraws the column behind it.
  const sidebarStyle = useSidebarStyle();

  const [newWorkspaceOpen, setNewWorkspaceOpen] = useState(false);
  const [schedulerOpen, setSchedulerOpen] = useState(false);
  const scheduledCount = useScheduledTaskCount();
  const { toasts, pushToast, dismissToast } = useToasts();
  const cancelWait = useCancelWait(pushToast);
  // Follows a held prompt to its session — in whichever tab or instance sent it.
  useWaitingDispatch({ onNotice: pushToast });

  // Batch selection: two separate modes (sessions from a workspace's `⋯` menu,
  // workspaces from the toolbar). The machine, the live pruned payload and the
  // confirmation dialog's state all come from one hook shared with the phone
  // drawer, so the two layouts cannot count or send a different set.
  const batch = useSidebarBatch(processedFolders, showArchived, refreshNow);
  const { selection, deleteRun, archiveRun, binding: batchBinding, scopeFolder, available: batchAvailable, selected: batchSelected } = batch;

  /**
   * Archive the selection. Reversible, so there is no confirmation dialog: the
   * rows move to the archive view, the sidebar refreshes once from the server's
   * own signal, and the run reports itself as one toast. A request-level error
   * keeps the selection so the user can retry; a completed run leaves the mode
   * because the rows it named are no longer in this list.
   */
  const handleArchiveSelected = () => {
    void archiveRun.archive(batchSelected).then((result) => {
      if (!result) return;
      const report = archiveOutcomeMessage(result);
      if (report) pushToast(report.message, report.tone);
      if (!result.error) selection.end();
    });
  };

  /** The folder whose context a new session will inherit — same resolution
   *  the send path uses, so the prewarmed cwd matches the spawn cwd. The
   *  access mode is deliberately not passed: the trigger reads the live
   *  setting, which is what the send path spawns with (`appSettings` here is
   *  the boot-time prop and goes stale the moment the composer changes it). */
  const prewarmForNewSession = (folderId?: number) => {
    const cwd = spawnCwdForNewSession(folders, sessionParam, folderId);
    if (cwd) triggerSessionPrewarm(cwd);
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

  const variantProps: SessionSidebarVariantProps = {
    // The chrome fills the column; the batch bar, when it exists, is a sibling
    // below it. `className` from the dock is the variant's own.
    className: `flex-1 min-h-0 w-full ${className}`,
    folders: processedFolders,
    initializing,
    activeSessionId,
    sessionStatus,
    searchQuery,
    onSearchChange: setSearchQuery,
    showArchived,
    onToggleArchived: () => setShowArchived(!showArchived),
    sortOption,
    optionsOpen,
    onToggleOptions: () => setOptionsOpen(!optionsOpen),
    onCloseOptions: () => setOptionsOpen(false),
    onSortChange: handleSortChange,
    onRefresh: refreshNow,
    refreshing: isRefreshing,
    scheduledCount,
    onNewSession: handleNewSession,
    onNewWorkspace: () => setNewWorkspaceOpen(true),
    onScheduler: () => setSchedulerOpen(true),
    onSelectSession: handleSelectSession,
    onNewSessionForFolder: handleNewSessionForFolder,
    onNewWorktreeSession: handleNewWorktreeSession,
    onToast: pushToast,
    onCancelWait: cancelWait,
    batch: batchBinding,
    onSelectWorkspaces: batch.toggleWorkspaceSelection,
    onStartSessionSelection: (folderId) => selection.begin('session', folderId),
  };

  return (
    <>
      <div className="flex flex-col h-full">
        {sidebarStyle === 'modern' ? (
          <ModernSidebarView {...variantProps} />
        ) : (
          <ClassicSidebarView {...variantProps} />
        )}

        {selection.mode && (
          <BatchActionBar
            mode={selection.mode}
            count={batchSelected.length}
            total={batchAvailable.length}
            busy={deleteRun.isDeleting}
            archiving={archiveRun.isArchiving}
            scopeLabel={scopeFolder?.name}
            onSelectAll={() => selection.selectAllOf(batchAvailable)}
            onUnselectAll={() => selection.unselectAllOf(batchAvailable)}
            onDelete={() => deleteRun.request(batchSelected)}
            onArchive={handleArchiveSelected}
            onCancel={selection.end}
          />
        )}
      </div>

      {/* Batch delete confirmation. It stays open on a refusal so the reasons
          can be read; a fully successful run closes itself and leaves the mode. */}
      <BatchDeleteModal
        mode={selection.mode ?? 'session'}
        count={deleteRun.pending.length}
        scopeLabel={scopeFolder?.name}
        isDeleting={deleteRun.isDeleting}
        outcome={deleteRun.outcome}
        onClose={() => {
          // A run that finished cleanly also ends the mode; one that refused
          // ids keeps it, so the rows that survived are still selected for a
          // second attempt.
          const refusedCount = deleteRun.outcome?.refused.length ?? 0;
          deleteRun.cancel();
          if (deleteRun.outcome && refusedCount === 0) selection.end();
        }}
        onConfirm={() => {
          const mode = selection.mode ?? 'session';
          void deleteRun.confirm(mode).then((result) => {
            // A finished run leaves the mode; a refused one keeps it so the
            // remaining rows are still selectable for a second attempt.
            if (result && result.refused.length === 0) selection.end();
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
