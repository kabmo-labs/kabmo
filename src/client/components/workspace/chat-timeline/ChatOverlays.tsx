/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The chat's modal layer.
 *
 * Every full-screen surface the timeline can raise sits here, so the parent
 * stays a layout shell and each surface's props are declared once. The order is
 * the stacking order: an undo confirmation, the New Chat card, a blocking
 * extension dialog, and the plan review — which is last because it is the only
 * one the AGENT is waiting on, and it must not end up behind a dialog that
 * arrived while the plan was being written.
 */

import type { Attachment } from '@/shared/types';
import type { ExtensionUiDialogRequest } from '@/shared/types/omp/agent';
import type { ApprovalMode } from '@/shared/lib/omp/config/access-mode';
import { ExtensionDialog } from '@/client/components/workspace/chat-timeline/tool-renderers/extension-dialog/Lazy';
import { NewChatModal } from '@/client/components/workspace/chat-timeline/NewChatModal';
import { UndoConfirmModal } from '@/client/components/workspace/chat-timeline/UndoConfirmModal';
import { PlanReviewPanel } from '@/client/components/workspace/chat-timeline/plan-review';
import type { ExtensionDialogResponse } from '@/client/components/workspace/chat-timeline/tool-renderers/extension-dialog/Lazy';
import type { PlanReviewState } from '@/client/hooks/chat/timeline/plan-review';

export interface ChatOverlaysProps {
  pendingUndo: { id: string; content: string } | null;
  undoing: boolean;
  undoError: string | null;
  onCloseUndo: () => void;
  onConfirmUndo: () => void;
  isOmpSession: boolean;

  newChatInitialContent: string | null;
  newChatInitialAttachments: Attachment[];
  onCloseNewChat: () => void;
  onSendNewChat: (content: string, attachments: Attachment[]) => void;
  appSettings: Record<string, unknown>;
  accessMode: ApprovalMode;
  onAccessModeChange: (mode: ApprovalMode) => void;
  composerModelRef: { current: { provider: string; modelId: string; thinkingLevel: string } | null };

  modalRequest: ExtensionUiDialogRequest | null;
  onRespondToFrame: (request: ExtensionUiDialogRequest, response: ExtensionDialogResponse) => void;

  planReview: PlanReviewState;
}

export function ChatOverlays({
  pendingUndo,
  undoing,
  undoError,
  onCloseUndo,
  onConfirmUndo,
  isOmpSession,
  newChatInitialContent,
  newChatInitialAttachments,
  onCloseNewChat,
  onSendNewChat,
  appSettings,
  accessMode,
  onAccessModeChange,
  composerModelRef,
  modalRequest,
  onRespondToFrame,
  planReview,
}: ChatOverlaysProps) {
  return (
    <>
      {pendingUndo && (
        <UndoConfirmModal
          isOmpSession={isOmpSession}
          content={pendingUndo.content}
          undoing={undoing}
          error={undoError}
          onClose={onCloseUndo}
          onConfirm={onConfirmUndo}
        />
      )}

      {newChatInitialContent !== null && (
        <NewChatModal
          initialContent={newChatInitialContent}
          initialAttachments={newChatInitialAttachments}
          onClose={onCloseNewChat}
          onSend={onSendNewChat}
          appSettings={appSettings}
          accessMode={accessMode}
          onAccessModeChange={onAccessModeChange}
          composerModelRef={composerModelRef}
        />
      )}

      {modalRequest && <ExtensionDialog request={modalRequest} onRespond={onRespondToFrame} />}

      {planReview.proposal && (
        <PlanReviewPanel
          proposal={planReview.proposal}
          deciding={planReview.deciding}
          error={planReview.error}
          onDecide={(choice, feedback) => void planReview.decide(choice, feedback)}
          onDismiss={planReview.dismiss}
        />
      )}
    </>
  );
}
