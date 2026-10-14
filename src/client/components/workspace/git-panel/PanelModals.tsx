import type { RefObject } from 'preact/compat';
import type { CommitHistoryPage } from '@/shared/types';
import type { ConfirmRequest } from '@/client/components/workspace/git-panel/confirm-request';
import { BranchPromptModal, ConfirmActionModal, GitOutputModal } from '@/client/components/workspace/git-panel/Modals';
import { GitBranchModal } from '@/client/components/workspace/git-panel/branch-modal';

interface GitPanelModalsProps {
  /** False until the panel has mounted, so a modal never renders on the server pass. */
  mounted: boolean;
  confirmModal: ConfirmRequest | null;
  onCloseConfirm: () => void;
  onConfirm: () => void;

  branchPrompt: boolean;
  newBranchName: string;
  newBranchInputRef: RefObject<HTMLInputElement>;
  onNewBranchNameChange: (value: string) => void;
  onCloseBranchPrompt: () => void;
  onCreateBranch: () => void;

  viewingOutput: CommitHistoryPage | null;
  onCloseOutput: () => void;
  onRefreshOutput: () => void;
  onExecuteAction: (actionType: string, file?: string, extra?: Record<string, string>) => void;

  branchModalOpen: boolean;
  onCloseBranchModal: () => void;
  rootPath?: string;
  activeRepo: string;
  currentBranch: string;
  detached: boolean;
  /** A panel action is in flight; the branch list re-reads when it settles. */
  isBusy: boolean;
  onBranchAction: (actionType: string, extra?: Record<string, string>) => void;
  /** Runs a `delete_branch` the modal's own dialog already confirmed. */
  onConfirmDeleteBranch: (name: string, force: boolean) => void;
}

/**
 * The panel's five modals, as one unit.
 *
 * Split out of `GitPanel` for the repo's line ceiling — and it is the natural
 * seam: every one of these is a dialog that mounts once and is opened by state
 * the panel owns, so none of them takes part in the panel's own render logic.
 * The `mounted` gate is the caller's (a modal rendered during the first pass
 * would be measured against a layout that does not exist yet).
 */
export function GitPanelModals({
  mounted,
  confirmModal,
  onCloseConfirm,
  onConfirm,
  branchPrompt,
  newBranchName,
  newBranchInputRef,
  onNewBranchNameChange,
  onCloseBranchPrompt,
  onCreateBranch,
  viewingOutput,
  onCloseOutput,
  onRefreshOutput,
  onExecuteAction,
  branchModalOpen,
  onCloseBranchModal,
  rootPath,
  activeRepo,
  currentBranch,
  detached,
  isBusy,
  onBranchAction,
  onConfirmDeleteBranch,
}: GitPanelModalsProps) {
  if (!mounted) return null;

  return (
    <>
      <ConfirmActionModal modal={confirmModal} onClose={onCloseConfirm} onConfirm={onConfirm} />

      <BranchPromptModal
        isOpen={branchPrompt}
        branchName={newBranchName}
        inputRef={newBranchInputRef}
        onChange={onNewBranchNameChange}
        onClose={onCloseBranchPrompt}
        onCreate={onCreateBranch}
      />

      <GitOutputModal
        output={viewingOutput}
        onClose={onCloseOutput}
        onRefresh={onRefreshOutput}
        onExecuteAction={onExecuteAction}
        rootPath={rootPath}
        activeRepo={activeRepo}
      />

      <GitBranchModal
        isOpen={branchModalOpen}
        rootPath={rootPath}
        repo={activeRepo}
        currentBranch={currentBranch}
        detached={detached}
        isBusy={isBusy}
        onClose={onCloseBranchModal}
        onAction={onBranchAction}
        onConfirmDelete={onConfirmDeleteBranch}
      />
    </>
  );
}
