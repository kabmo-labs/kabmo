/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The draft-target row above a not-yet-started chat: where it runs, in which
 * checkout, under which parent, and what it waits for.
 *
 * One row because these are one question — the context the first prompt is born
 * into — and splitting it back into the composer would put four independent
 * placements in two files. Extracted from `EmptyWorkspacePrompt` for the
 * per-file ceiling.
 */

import { WorkspacePicker } from '@/client/components/workspace/chat-timeline/target-picker/WorkspacePicker';
import { WorktreePicker } from '@/client/components/workspace/chat-timeline/target-picker/WorktreePicker';
import { ParentSessionPicker } from '@/client/components/workspace/chat-timeline/target-picker/ParentSessionPicker';
import {
  WaitingDependencyPicker,
  type WaitingCandidate,
} from '@/client/components/workspace/chat-timeline/chat-input/WaitingDependencyPicker';
import type { SpawnTarget } from '@/client/hooks/chat/timeline/spawn-target';
import type { WorkspaceFolderData } from '@/shared/types';
import type { ToastTone } from '@/shared/lib/ui/toast-duration';

export interface DraftTargetRowProps {
  folders: WorkspaceFolderData[];
  selectedFolderId: number | null;
  setSelectedFolderId: (id: number | null) => void;
  spawnTarget?: SpawnTarget | null;
  onSpawnTargetChange?: (next: SpawnTarget | null) => void;
  /** Reports a worktree the composer created or failed to create. */
  onWorktreeReport?: (message: string, tone?: ToastTone) => void;
  /** The session this chat runs under, or null for a top-level chat. */
  parentSessionId?: string | null;
  onParentSessionChange?: (sessionId: string | null) => void;
  /** "Parent session" for a child, "Fork from" for a fork. */
  branchLabel?: string;
  /** False when the pending chat must have a source (a fork). */
  branchAllowNone?: boolean;
  waitingFor?: WaitingCandidate | null;
  onWaitingForChange?: (candidate: WaitingCandidate | null) => void;
  candidates: WaitingCandidate[];
}

export function DraftTargetRow({
  folders,
  selectedFolderId,
  setSelectedFolderId,
  spawnTarget = null,
  onSpawnTargetChange,
  onWorktreeReport,
  parentSessionId = null,
  onParentSessionChange,
  branchLabel = 'Parent session',
  branchAllowNone = true,
  waitingFor = null,
  onWaitingForChange,
  candidates,
}: DraftTargetRowProps) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {/* Two controls, because they answer two questions: the workspace (which
          project) and the worktree (which checkout of it). The worktree control
          draws itself only for a git repository, and it reads its list on mount
          because its own trigger names the branch the project root holds. */}
      <WorkspacePicker
        folders={folders}
        selectedFolderId={selectedFolderId}
        setSelectedFolderId={setSelectedFolderId}
        onClearWorktree={() => onSpawnTargetChange?.(null)}
      />
      {onSpawnTargetChange && (
        <WorktreePicker
          folders={folders}
          selectedFolderId={selectedFolderId}
          target={spawnTarget}
          setTarget={onSpawnTargetChange}
          onReport={onWorktreeReport}
        />
      )}
      {/* ALL sessions, not just the active one: the composer may have been
          opened from one row and the user may want the chat under another.
          Choosing a parent also moves the workspace to that session's folder. */}
      {onParentSessionChange && (
        <ParentSessionPicker
          folders={folders}
          value={parentSessionId}
          onChange={onParentSessionChange}
          label={branchLabel}
          allowNone={branchAllowNone}
        />
      )}
      {/* The wait picker sits BESIDE the workspace picker, because both answer
          the same question about the chat that has not started: where it runs,
          and what it waits for. It only appears while there is something to
          wait for (or a pick already made). */}
      {onWaitingForChange && (waitingFor || candidates.length > 0) && (
        <WaitingDependencyPicker
          candidates={candidates}
          value={waitingFor}
          onChange={onWaitingForChange}
        />
      )}
    </div>
  );
}
