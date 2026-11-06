import { ChevronDown, ChevronRight, GitBranch, MessageSquare, Plus } from 'lucide-preact';
import { FolderItemMenu } from '@/client/components/mobile/mobile-session-sidebar/ItemMenu';
import { useSearchParams } from '@/client/lib/router/search-params';
import { MobileSessionRow } from '@/client/components/mobile/mobile-session-sidebar/SessionRow';
import { SubagentList } from '@/client/components/common/subagent-list';
import { useWorktreeDialog } from '@/client/components/mobile/mobile-session-sidebar/WorktreeDialog';
import { useShowMore } from '@/client/hooks/ui/show-more';
import { useExpandedSessions } from '@/client/hooks/workspace/expanded-sessions';
import { useWorkspaceFolderActions } from '@/client/hooks/workspace/workspace-folder-actions';
import { useSessionDelete } from '@/client/hooks/workspace/session-delete';
import { SessionDeleteModal } from '@/client/components/common/session-delete-modal';
import { getProjectIcon } from '@/shared/lib/workspace/project-icon';
import { relativeTimeAgo } from '@/shared/lib/workspace/relative-time';
import { useSidebarData } from '@/client/hooks/chat/omp/session-list';
import type { WorkspaceFolderData } from '@/shared/types';
import type { BatchBinding } from '@/client/components/common/batch-selection/types';
import { folderBatchState } from '@/client/components/common/batch-selection/folder-state';
import { SelectionCheckbox } from '@/client/components/common/batch-selection/SelectionCheckbox';
import { SessionRevealRow } from '@/client/components/mobile/mobile-session-sidebar/RevealRow';
import { folderGroupGap } from '@/client/components/mobile/mobile-session-sidebar/folder-gap';

interface MobileSessionCategoryProps {
  folder: WorkspaceFolderData;
  activeSessionId: number | string | null;
  onSelectSession: (id: number | string) => void;
  onNewSessionForFolder: (folderId: number) => void;
  /** Start a chat in a worktree made from this folder. */
  onNewWorktreeSession?: (folderId: number, worktreePath: string) => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
  showArchived?: boolean;
  sessionStatus?: Record<string, 'stream' | 'finish' | 'abort'>;
  onToast?: (message: string, type?: 'success' | 'error') => void;
  /** Present only while a batch selection is active; absent is the normal list. */
  batch?: BatchBinding;
  /** Start a session selection scoped to this workspace, from its `⋯` menu. */
  onStartSessionSelection?: (folderId: number) => void;
  /** Drop a held prompt from its row's menu. */
  onCancelWait?: (waitId: string) => void;
}

export function MobileSessionCategory({
  folder,
  activeSessionId,
  onSelectSession,
  onNewSessionForFolder,
  onNewWorktreeSession,
  isExpanded,
  onToggleExpand,
  showArchived = false,
  sessionStatus = {},
  onToast,
  batch,
  onStartSessionSelection,
  onCancelWait,
}: MobileSessionCategoryProps) {
  const { visibleCount, showMore, showLess, canShowLess } = useShowMore();
  // The phone's folder row opens the same dialog the desktop one does. Its state
  // lives in a hook so this row stays under the size ceiling.
  const worktreeDialog = useWorktreeDialog(folder, (worktreePath) =>
    onNewWorktreeSession?.(folder.id, worktreePath),
  );
  const { refresh } = useSidebarData();
  const { expandedSessionIds, toggleSession } = useExpandedSessions();
  // The viewed transcript, so its session row dims while a roster entry is
  // open (desktop parity — same params, same rule).
  const [searchParams] = useSearchParams();
  const urlSubagentId = searchParams.get('subagent');
  const urlSessionId = searchParams.get('sessionId');
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

  // The `⋯` menu closes itself around each action (`ItemMenu`), so these stay
  // plain: the reveal path is the one that used to leave the menu over its own
  // toast.
  const onPin = handlePin;
  const onDelete = handleDelete;
  const onOpenFolder = handleOpenFolder ?? undefined;

  // Archived rows are filtered first; the badge reports the visible set so the
  // count always matches what the list can actually show.
  const filteredSessions = (folder.sessions || []).filter((s) =>
    showArchived ? s.is_archived === 1 : s.is_archived !== 1
  );
  const ProjectIcon = getProjectIcon(folder.icon);

  // Batch rules are shared with the desktop category (`folderBatchState`), so
  // the phone cannot offer a different scope, summary or pagination rule.
  const {
    folderCheckbox,
    sessionCheckboxes,
    folderSummary,
    toggleFolderSelection,
    rendered: visibleSessions,
    hiddenCount,
  } = folderBatchState({
    batch,
    folder,
    sessions: filteredSessions,
    showArchived,
    visibleCount,
    activeSessionId,
    sessionStatus,
  });
  const listOpen = isExpanded || sessionCheckboxes;

  return (
    <div className={folderGroupGap(listOpen)} data-testid="session-folder">
      <div
        onClick={batch ? undefined : onToggleExpand}
        // `py-1`, not `py-2`: the header's height is set by its own action
        // buttons (27px, `p-1.5` around a 15px glyph — the touch target), so
        // 8px of vertical padding made a folder header 43px against the 33px
        // of the session rows it stands in for. A closed folder is a row, and
        // two of them read as one list only if they are built like rows.
        // Measured on a 390px phone: 43px → 35px, 2px off a session row.
        className="flex items-center justify-between gap-2 py-1 cursor-pointer hover:bg-ink/5 rounded-lg select-none transition-colors"
      >
        <div className="flex items-center space-x-2 min-w-0">
          {folderCheckbox && folderSummary ? (
            <SelectionCheckbox
              size="md"
              checked={folderSummary.all}
              indeterminate={folderSummary.some}
              label={`Select ${folder.name}`}
              onChange={toggleFolderSelection}
            />
          ) : (
          <>
          {/* The folder glyph occupies the same 16px slot the session rows give
              their status/roster glyph, and the row carries NO leading inset of
              its own: the drawer list's `p-3` is the gutter, so this glyph starts
              at the same x as the New Session button above it (12px) and as the
              search field's frame. One left edge down the whole drawer. */}
          <span className="w-4 h-4 flex items-center justify-center flex-shrink-0">
            {folder.customIconUrl ? (
              <img
                src={folder.customIconUrl}
                alt=""
                className="w-[15px] h-[15px] rounded-xs object-contain"
                referrerPolicy="no-referrer"
              />
            ) : folder.iconType === 'chat' ? (
              <MessageSquare size={15} className="text-ink/80" />
            ) : (
              <ProjectIcon
                size={15}
                className="text-ink/80"
                style={{ color: folder.accentColor || undefined }}
              />
            )}
          </span>
          </>
          )}

          <span className="text-sm font-semibold text-ink truncate">
            {folder.name}
          </span>
        </div>

        <div className="flex items-center space-x-2 text-xs text-ink/60">
          <span className="font-mono text-[11px] text-ink/70">
            {filteredSessions.length}
          </span>

          {folder.project_path && (
            <GitBranch size={13} className="text-ink/50 ml-1" />
          )}

          {!batch && (
          <>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onNewSessionForFolder(folder.id);
            }}
            className="p-1.5 rounded-lg hover:bg-ink/10 active:bg-ink/15 text-ink/60 hover:text-ink"
            title="New Session"
            aria-label={`New session in ${folder.name}`}
          >
            <Plus size={15} />
          </button>

          <FolderItemMenu
            folder={folder}
            canWorktree={Boolean(onNewWorktreeSession && folder.project_path)}
            onOpenFolder={onOpenFolder}
            onNewWorktree={onNewWorktreeSession ? () => worktreeDialog.open() : undefined}
            onSelectSessions={
              onStartSessionSelection ? () => onStartSessionSelection(folder.id) : undefined
            }
            confirmDelete={confirmDelete}
            onPin={onPin}
            onDelete={onDelete}
            onRequestDelete={requestDelete}
            onCancelDelete={cancelDelete}
          />

          {/* The disclosure glyph's BOX ends on the list's content edge — the
              same x the toolbar row's last control ends on above it — and its
              ink sits 4px inside it (`pr-1`), which is the inset a session
              row's `⋯` / roster chevron uses. So the drawer's right column is
              one line of INK, not just one line of boxes: measured before, the
              folder chevron's ink ran 6px further right than every row glyph
              beneath it. */}
          <span className="flex items-center justify-center pr-1">
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
          </>
          )}
        </div>
      </div>

      {listOpen && (
        <div className="mt-0.5 space-y-0.5">
          {visibleSessions.map((session) => {
            const sessionKey = String(session.id);
            const isSessionActive = String(activeSessionId) === sessionKey;
            // While one of its subagents is being viewed, the parent session
            // row dims so the highlighted roster entry reads as the active one
            // (desktop parity).
            const isViewingSubagent = isSessionActive && urlSessionId === sessionKey && Boolean(urlSubagentId);
            // Same gate as desktop: the omp-side loader flag is authoritative,
            // so a session whose roster exists on disk can be opened without a
            // live process.
            const hasSubagents = Boolean(session.hasSubagents);
            const isRosterOpen = hasSubagents && expandedSessionIds.has(sessionKey);

            return (
              <div key={session.id} className="space-y-0.5">
                <MobileSessionRow
                  session={session}
                  harness={session.harness}
                  isActive={isSessionActive && !isViewingSubagent}
                  status={sessionStatus[sessionKey]}
                  awaitingInput={Boolean(session.awaitingInput)}
                  timeAgo={relativeTimeAgo(session.updated_at ?? session.created_at)}
                  hasSubagents={hasSubagents}
                  isExpanded={isRosterOpen}
                  onToggleExpand={() => toggleSession(sessionKey)}
                  onSelect={() => onSelectSession(session.id)}
                  onArchive={() => handleArchive(session)}
                  onDelete={
                    // A pending `new-…` chat has no transcript anywhere yet —
                    // there is nothing to delete, and the server refuses it.
                    sessionKey.startsWith('new-')
                      ? undefined
                      : () => sessionDelete.requestDelete(session)
                  }
                  onRename={sessionKey.startsWith('new-') ? undefined : (name) => void handleRename(session, name)}
                  onRenameWithAi={
                    sessionKey.startsWith('new-') ? undefined : () => void handleRenameWithAi(session)
                  }
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
                {isRosterOpen && (
                  <SubagentList sessionId={session.id} isActiveSession={isSessionActive} />
                )}
              </div>
            );
          })}

          <SessionRevealRow
            hiddenCount={sessionCheckboxes ? 0 : hiddenCount}
            canShowLess={!sessionCheckboxes && canShowLess}
            onShowMore={showMore}
            onShowLess={showLess}
          />

        </div>
      )}

      <SessionDeleteModal
        session={sessionDelete.pending}
        isDeleting={sessionDelete.isDeleting}
        error={sessionDelete.error}
        onClose={sessionDelete.cancelDelete}
        onConfirm={() => void sessionDelete.confirmDelete()}
      />

      {worktreeDialog.dialog}
    </div>
  );
}
