/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One workspace in the `modern` sidebar: its sticky header, its rows, its
 * pagination and the dialogs those rows own.
 *
 * It is NOT a second implementation of a workspace. Every rule that governs a
 * folder — which rows the archive filter offers, what the header checkbox
 * reports, which window of rows is shown, what a rename or a delete issues — is
 * the same hook the classic category calls (`folderBatchState`,
 * `useWorkspaceFolderActions`, `useSessionDelete`, `useShowMore`,
 * `useExpandedSessions`). Only the markup differs. That is what makes the style
 * setting safe: a fix to a folder action lands in one place and appears in both.
 *
 * Two behaviours are deliberately identical to the classic list, because each
 * one was a reported bug there:
 *
 * - a session selection LIFTS the pagination window (`folderBatchState`), so a
 *   checkbox cannot be ticked on a row that has no checkbox on screen;
 * - the search forces every workspace open, so a match inside a collapsed folder
 *   is not silently hidden.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import { ChevronDown, ChevronUp } from 'lucide-preact';
import { useSearchParams } from '@/client/lib/router/search-params';
import { useFetcher } from '@/client/lib/router/fetcher';
import { useOnClickOutside } from '@/client/hooks/ui/on-click-outside';
import { useShowMore } from '@/client/hooks/ui/show-more';
import { useWorkspaceFolderActions } from '@/client/hooks/workspace/workspace-folder-actions';
import { useSessionDelete } from '@/client/hooks/workspace/session-delete';
import { useExpandedSessions } from '@/client/hooks/workspace/expanded-sessions';
import { useSidebarData } from '@/client/hooks/chat/omp/session-list';
import { SessionRow, type SessionRowDensity } from '@/client/components/common/session-row';
import { SubagentList } from '@/client/components/common/subagent-list';
import { SessionDeleteModal } from '@/client/components/common/session-delete-modal';
import { WorkspaceOptionsMenu } from '@/client/components/common/workspace-options-menu';
import { NewWorktreeModal } from '@/client/components/workspace/worktree-modal/index';
import { WorkspaceHeader } from '@/client/components/layout/session-sidebar/modern/WorkspaceHeader';
import { folderBatchState } from '@/client/components/common/batch-selection/folder-state';
import { relativeTimeAgo } from '@/shared/lib/workspace/relative-time';
import type { BatchBinding } from '@/client/components/common/batch-selection/types';
import type { SessionStatusMap } from '@/client/components/layout/session-sidebar/variant-props';
import type { WorkspaceFolderData } from '@/shared/types';

export interface WorkspaceSectionProps {
  folder: WorkspaceFolderData;
  activeSessionId: number | string | null;
  sessionStatus: SessionStatusMap;
  showArchived: boolean;
  /** True while a search is active: every workspace opens to show its matches. */
  forceExpanded?: boolean;
  /** Row density: `touch` on the phone drawer, `compact` on the desktop dock. */
  density?: SessionRowDensity;
  batch?: BatchBinding;
  onSelectSession: (id: number | string) => void;
  onNewSessionForFolder: (folderId: number) => void;
  onNewWorktreeSession?: (folderId: number, worktreePath: string) => void;
  onToast: (message: string, type?: 'success' | 'error') => void;
  onStartSessionSelection?: (folderId: number) => void;
  onCancelWait?: (waitId: string) => void;
}

export function WorkspaceSection({
  folder,
  activeSessionId,
  sessionStatus,
  showArchived,
  forceExpanded = false,
  density = 'compact',
  batch,
  onSelectSession,
  onNewSessionForFolder,
  onNewWorktreeSession,
  onToast,
  onStartSessionSelection,
  onCancelWait,
}: WorkspaceSectionProps) {
  const [isOpen, setIsOpen] = useState(folder.isExpanded || false);
  const [showMenu, setShowMenu] = useState(false);
  const [worktreeOpen, setWorktreeOpen] = useState(false);
  const { visibleCount, showMore, showLess, canShowLess } = useShowMore();
  const [searchParams] = useSearchParams();
  const urlSubagentId = searchParams.get('subagent');
  const urlSessionId = searchParams.get('sessionId');
  const { expandedSessionIds, toggleSession } = useExpandedSessions();
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

  // The stored flag is the source of truth, so a collapse made on the phone
  // arrives here too. Keyed on the flag itself, not the folder object, which is
  // a new identity on every structure push.
  useEffect(() => {
    if (typeof folder.isExpanded === 'boolean') setIsOpen(folder.isExpanded);
  }, [folder.isExpanded]);

  useOnClickOutside(menuRef, () => {
    setShowMenu(false);
    cancelDelete();
  });

  const toggleFolder = () => {
    const next = !isOpen;
    setIsOpen(next);
    if (typeof folder.id !== 'number') return;
    toggleFetcher.submit(
      { isExpanded: String(next) },
      { method: 'POST', action: `/api/folders/${folder.id}/toggle` },
    );
  };

  const offered = folder.sessions.filter((session) =>
    showArchived ? session.is_archived === 1 : session.is_archived !== 1,
  );

  const {
    folderCheckbox,
    sessionCheckboxes,
    folderSummary,
    toggleFolderSelection,
    rendered,
    hiddenCount,
  } = folderBatchState({
    batch,
    folder,
    sessions: offered,
    showArchived,
    visibleCount,
    activeSessionId,
    sessionStatus,
  });

  // A session selection opens every workspace: a checkbox on a collapsed folder
  // would let the user select rows they cannot see or unselect.
  const listOpen = forceExpanded || isOpen || sessionCheckboxes;
  const canCreateWorktree = Boolean(onNewWorktreeSession && folder.project_path);

  return (
    <div className="space-y-0.5">
      <WorkspaceHeader
        folder={folder}
        isOpen={listOpen}
        onToggleFolder={toggleFolder}
        sessionCount={offered.length}
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
        onToggleMenu={() => setShowMenu((open) => !open)}
        onNewSession={() => onNewSessionForFolder(folder.id)}
        touch={density === 'touch'}
        menu={
          <WorkspaceOptionsMenu
            variant="desktop"
            isPinned={folder.isPinned}
            onOpenFolder={
              handleOpenFolder
                ? () => {
                    handleOpenFolder();
                    setShowMenu(false);
                  }
                : undefined
            }
            onSelectSessions={
              onStartSessionSelection
                ? () => {
                    setShowMenu(false);
                    onStartSessionSelection(folder.id);
                  }
                : undefined
            }
            onNewWorktree={
              canCreateWorktree
                ? () => {
                    setShowMenu(false);
                    setWorktreeOpen(true);
                  }
                : undefined
            }
            confirmDelete={confirmDelete}
            onPin={() => {
              handlePin();
              setShowMenu(false);
            }}
            onDelete={() => {
              handleDelete();
              setShowMenu(false);
            }}
            onRequestDelete={requestDelete}
            onCancelDelete={cancelDelete}
          />
        }
      />

      {listOpen && (
        <div className="space-y-0.5">
          {rendered.map((session) => {
            const key = String(session.id);
            const isActive = activeSessionId !== null
              ? String(activeSessionId) === key
              : session.is_active === 1;
            // While one of its subagents is being viewed, the parent row dims so
            // the highlighted roster entry reads as the active one.
            const viewingSubagent = isActive && urlSessionId === key && Boolean(urlSubagentId);
            const hasSubagents = Boolean(session.hasSubagents);
            const isExpanded = hasSubagents && expandedSessionIds.has(key);
            const pending = key.startsWith('new-');

            return (
              <div key={session.id} className="space-y-0.5">
                <SessionRow
                  sessionId={session.id}
                  title={session.title}
                  density={density}
                  isActive={isActive && !viewingSubagent}
                  isArchived={session.is_archived === 1}
                  status={sessionStatus[key]}
                  awaitingInput={Boolean(session.awaitingInput)}
                  timeAgo={relativeTimeAgo(session.updated_at ?? session.created_at)}
                  worktree={session.worktree}
                  waitingFor={session.waitingFor ? { title: session.waitingFor.title } : undefined}
                  hasSubagents={hasSubagents}
                  isExpanded={isExpanded}
                  onToggleExpand={() => toggleSession(key)}
                  onClick={() => onSelectSession(session.id)}
                  onArchive={() => handleArchive(session)}
                  // A pending `new-…` chat has no transcript anywhere yet, so
                  // there is nothing to delete and nothing to rename from.
                  onDelete={pending ? undefined : () => sessionDelete.requestDelete(session)}
                  onRename={pending ? undefined : (name) => void handleRename(session, name)}
                  onRenameWithAi={pending ? undefined : () => void handleRenameWithAi(session)}
                  onCancelWait={
                    session.waitingFor ? () => onCancelWait?.(session.waitingFor!.waitId) : undefined
                  }
                  selectable={sessionCheckboxes}
                  selected={Boolean(batch?.selected.includes(key))}
                  onToggleSelect={batch ? () => batch.toggle(key) : undefined}
                />
                {hasSubagents && isExpanded && (
                  <SubagentList
                    sessionId={session.id}
                    isActiveSession={activeSessionId !== null && key === String(activeSessionId)}
                  />
                )}
              </div>
            );
          })}

          {/* Reveal and collapse are two controls, not a toggle: the list is
              truncated for height, so after a partial reveal the user needs to
              keep going AND to start over. */}
          {(hiddenCount > 0 || canShowLess) && !forceExpanded && !sessionCheckboxes && (
            <div className="flex items-center gap-1 pl-6">
              {hiddenCount > 0 && (
                <button
                  type="button"
                  onClick={showMore}
                  className="min-w-0 truncate rounded-md px-1 py-1 text-[11px] text-ink/45 transition-colors cursor-pointer hover:bg-ink/[0.04] hover:text-ink/80"
                >
                  <ChevronDown size={11} className="mr-1 inline align-[-2px]" />
                  {hiddenCount} more
                </button>
              )}
              {canShowLess && (
                <button
                  type="button"
                  onClick={showLess}
                  className="ml-auto shrink-0 rounded-md px-1 py-1 text-[11px] text-ink/45 transition-colors cursor-pointer hover:bg-ink/[0.04] hover:text-ink/80"
                >
                  <ChevronUp size={11} className="mr-1 inline align-[-2px]" />
                  Less
                </button>
              )}
            </div>
          )}

          {offered.length === 0 && (
            <div className="px-1 py-1 pl-6 text-[11px] italic text-ink/40">
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

      {canCreateWorktree && (
        <NewWorktreeModal
          isOpen={worktreeOpen}
          onClose={() => setWorktreeOpen(false)}
          root={folder.project_path ?? null}
          folderId={folder.id}
          folderName={folder.name}
          onCreated={(created) => {
            setWorktreeOpen(false);
            onNewWorktreeSession?.(folder.id, created.path);
          }}
        />
      )}
    </div>
  );
}
