import { useEffect, useRef, useState } from 'preact/hooks';
import { ChevronDown, ChevronUp } from 'lucide-preact';
import { useSearchParams } from '@/client/lib/router/search-params';
import { useFetcher } from '@/client/lib/router/fetcher';
import { useOnClickOutside } from '@/client/hooks/ui/on-click-outside';
import { useShowMore } from '@/client/hooks/ui/show-more';
import { useWorkspaceFolderActions } from '@/client/hooks/workspace/workspace-folder-actions';
import { useSessionDelete } from '@/client/hooks/workspace/session-delete';
import { SessionDeleteModal } from '@/client/components/common/session-delete-modal';
import { SessionItem } from '@/client/components/layout/session-sidebar/SessionItem';
import { CategoryHeader } from '@/client/components/layout/session-sidebar/CategoryHeader';
import { SubagentList } from '@/client/components/common/subagent-list';
import { useExpandedSessions } from '@/client/hooks/workspace/expanded-sessions';
import { relativeTimeAgo } from '@/shared/lib/workspace/relative-time';
import { useSidebarData } from '@/client/hooks/chat/omp/session-list';
import type { BatchBinding } from '@/client/components/common/batch-selection/types';
import { folderBatchState } from '@/client/components/common/batch-selection/folder-state';
import type { WorkspaceFolderData } from '@/shared/types';

export { SessionItem };

export function Category({ 
  folder, 
  activeSessionId, 
  onSelectSession,
  onNewSessionForFolder,
  forceExpanded = false,
  showArchived = false,
  sessionStatus = {},
  onToast,
  batch,
  onStartSessionSelection,
  onCancelWait,
}: { 
  folder: WorkspaceFolderData;
  activeSessionId: number | string | null;
  onSelectSession: (id: number | string) => void;
  onNewSessionForFolder: (id: number) => void;
  forceExpanded?: boolean;
  showArchived?: boolean;
  sessionStatus?: Record<string, 'stream' | 'finish' | 'abort'>;
  onToast?: (message: string, type?: 'success' | 'error') => void;
  /** Present only while a batch selection is active; absent is the normal list. */
  batch?: BatchBinding;
  /** Start a session selection scoped to this workspace, from its `⋯` menu. */
  onStartSessionSelection?: (folderId: number) => void;
  /** Drop the held prompt of one row (`waitingFor.waitId`). */
  onCancelWait?: (waitId: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(folder.isExpanded || false);
  const [showMenu, setShowMenu] = useState(false);
  const { visibleCount, showMore, showLess, canShowLess } = useShowMore();
  const [searchParams] = useSearchParams();
  const urlSubagentId = searchParams.get('subagent');
  const urlSessionId = searchParams.get('sessionId');

  // Roster expansion is shared with the mobile drawer: one persisted set, so a
  // row expanded on the phone is expanded here too.
  const { expandedSessionIds, toggleSession } = useExpandedSessions();

  useEffect(() => {
    if (typeof folder.isExpanded === 'boolean') setIsOpen(folder.isExpanded);
  }, [folder.isExpanded]);
  
  const menuRef = useRef<HTMLDivElement>(null);
  const { refresh } = useSidebarData();
  const toggleFetcher = useFetcher<{ success?: boolean }>();
  const {
    confirmDelete,
    requestDelete,
    cancelDelete,
    handlePin,
    handleDelete,
    handleArchive,
    handleRename,
    handleRenameWithAi,
    handleOpenFolder,
  } = useWorkspaceFolderActions(folder, refresh, onToast);
  const sessionDelete = useSessionDelete();

  useOnClickOutside(menuRef, () => {
    setShowMenu(false);
    cancelDelete();
  });

  const allSessions = folder.sessions;

  const toggleFolder = () => {
    const nextState = !isOpen;
    setIsOpen(nextState);
    if (typeof folder.id !== 'number') {
      return;
    }
    toggleFetcher.submit(
      { isExpanded: String(nextState) },
      { method: 'POST', action: `/api/folders/${folder.id}/toggle` }
    );
  };

  const handleToggleSessionExpand = (sessionId: string) => {
    toggleSession(sessionId);
  };

  const onPin = () => {
    handlePin();
    setShowMenu(false);
  };

  const onDelete = () => {
    handleDelete();
    setShowMenu(false);
  };

  // Reveal is an action like Pin or Delete, so the menu closes on it — leaving
  // it standing would hide the header the toast is describing.
  const onOpenFolder = handleOpenFolder
    ? () => {
        handleOpenFolder();
        setShowMenu(false);
      }
    : undefined;

  const isActuallyOpen = forceExpanded || isOpen;

  const visibleSessions = (allSessions || []).filter((s) =>
    showArchived ? s.is_archived === 1 : s.is_archived !== 1
  );

  // Batch rules live in one shared module — the phone's drawer item reads the
  // same function, so the two layouts cannot disagree about which rows a
  // header owns or what its checkbox reports.
  const {
    folderCheckbox,
    sessionCheckboxes,
    folderSummary,
    toggleFolderSelection,
    rendered: renderedSessions,
    hiddenCount,
  } = folderBatchState({
    batch,
    folder,
    sessions: visibleSessions,
    showArchived,
    visibleCount,
    activeSessionId,
    sessionStatus,
  });
  // A session selection opens every folder: a checkbox on a collapsed workspace
  // would let the user select rows they cannot see or unselect. The WORKSPACE
  // mode leaves the expansion alone — it selects folders, not rows.
  const listOpen = isActuallyOpen || sessionCheckboxes;
  const hasMore = hiddenCount > 0;

  return (
    <div className="space-y-1">
      <CategoryHeader
        folder={folder}
        isOpen={isActuallyOpen}
        onToggleFolder={toggleFolder}
        checkbox={
          folderCheckbox && folderSummary
            ? {
                checked: folderSummary.all,
                indeterminate: folderSummary.some,
                label: `Select ${folder.name}`,
                onChange: toggleFolderSelection,
              }
            : null
        }
        batchActive={Boolean(batch)}
        menuRef={menuRef}
        showMenu={showMenu}
        onToggleMenu={() => setShowMenu(!showMenu)}
        onNewSession={() => onNewSessionForFolder(folder.id)}
        onOpenFolder={onOpenFolder}
        onSelectSessions={
          onStartSessionSelection
            ? () => { setShowMenu(false); onStartSessionSelection(folder.id); }
            : undefined
        }
        confirmDelete={confirmDelete}
        onPin={onPin}
        onDelete={onDelete}
        onRequestDelete={requestDelete}
        onCancelDelete={cancelDelete}
      />
      
      {/* Sessions List */}
      {listOpen && (
        <div className="space-y-0.5">
          {renderedSessions.map((session) => {
            const sessionKey = String(session.id);
            const isActive = activeSessionId !== null
              ? String(activeSessionId) === sessionKey
              : session.is_active === 1;
            // While one of its subagents is being viewed, the parent session
            // row dims so the highlighted roster entry reads as the active one.
            const isViewingSubagent = isActive && urlSessionId === sessionKey && Boolean(urlSubagentId);
            const canExpandActive = activeSessionId !== null && sessionKey === String(activeSessionId);
            // Chevron gate comes straight from the omp-side loader flag
            // (disk scan + transcript recovery); the client never overrides it.
            const hasSubagents = Boolean(session.hasSubagents);
            const isExpanded = hasSubagents && expandedSessionIds.has(sessionKey);

            return (
              <div key={session.id} className="space-y-0.5">
                <SessionItem
                  sessionId={session.id}
                  title={session.title}
                  isActive={isActive && !isViewingSubagent}
                  isArchived={session.is_archived === 1}
                  status={sessionStatus[sessionKey]}
                  awaitingInput={Boolean(session.awaitingInput)}
                  timeAgo={relativeTimeAgo(session.updated_at ?? session.created_at)}
                  onClick={() => onSelectSession(session.id)}
                  onArchive={() => handleArchive(session)}
                  onDelete={
                    // A pending `new-…` chat has no transcript anywhere yet —
                    // there is nothing to delete, and the server refuses it.
                    String(session.id).startsWith('new-')
                      ? undefined
                      : () => sessionDelete.requestDelete(session)
                  }
                  onRename={String(session.id).startsWith('new-') ? undefined : (name) => void handleRename(session, name)}
                  onRenameWithAi={
                    String(session.id).startsWith('new-') ? undefined : () => void handleRenameWithAi(session)
                  }
                  expandable={hasSubagents}
                  hasSubagents={hasSubagents}
                  isExpanded={isExpanded}
                  onToggleExpand={() => handleToggleSessionExpand(sessionKey)}
                  waitingFor={session.waitingFor ? { title: session.waitingFor.title } : undefined}
                  onCancelWait={
                    session.waitingFor
                      ? () => onCancelWait?.(session.waitingFor!.waitId)
                      : undefined
                  }
                  selectable={sessionCheckboxes}
                  selected={Boolean(batch?.selected.includes(sessionKey))}
                  onToggleSelect={batch ? () => batch.toggle(sessionKey) : undefined}
                />
                {hasSubagents && isExpanded && (
                  <SubagentList sessionId={session.id} isActiveSession={canExpandActive} />
                )}
              </div>
            );
          })}

          {/* Reveal / collapse controls — one row, reveal on the left and
              collapse on the right. They are not a toggle: the list is
              truncated for height, so after a partial reveal the user needs to
              keep revealing AND to start over, which is what two controls say
              and one alternating control cannot. */}
          {(hasMore || canShowLess) && !forceExpanded && !sessionCheckboxes && (
            <div className="flex items-center gap-1">
              {hasMore && (
                <button
                  type="button"
                  onClick={showMore}
                  className="flex items-center min-w-0 text-xs text-ink/45 hover:text-ink/80 py-1.5 px-2 rounded-lg hover:bg-ink/5 transition-colors cursor-pointer select-none"
                >
                  {/* The chevron sits in the same 16px slot the rows give their
                      status/roster glyph, and the label starts where a row's title
                      does — the disclosure control lines up with the list it
                      reveals instead of floating beside it. */}
                  <span className="w-4 h-4 shrink-0 flex items-center justify-center">
                    <ChevronDown size={12} />
                  </span>
                  <span className="w-2 shrink-0" />
                  <span className="truncate leading-snug">
                    Show more sessions ({hiddenCount})
                  </span>
                </button>
              )}

              {canShowLess && (
                <button
                  type="button"
                  onClick={showLess}
                  className="ml-auto shrink-0 flex items-center gap-1 text-xs text-ink/45 hover:text-ink/80 py-1.5 px-2 rounded-lg hover:bg-ink/5 transition-colors cursor-pointer select-none"
                >
                  <ChevronUp size={12} />
                  <span className="truncate leading-snug">Show less</span>
                </button>
              )}
            </div>
          )}

          {visibleSessions.length === 0 && (
            <div className="px-3 py-2 text-[11px] text-ink/40 italic">
              {showArchived ? 'No archived sessions.' : 'No sessions.'}
            </div>
          )}
        </div>
      )}

      <SessionDeleteModal
        session={sessionDelete.pending}
        isDeleting={sessionDelete.isDeleting}
        error={sessionDelete.error}
        onClose={sessionDelete.cancelDelete}
        onConfirm={() => void sessionDelete.confirmDelete()}
      />
    </div>
  );
}
