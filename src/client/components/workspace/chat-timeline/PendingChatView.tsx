/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The PENDING chat's own view: the workspace/wait pickers, its optimistic
 * rows, and the composer it hands them to.
 *
 * Split out of `chat-timeline/index.tsx` for the per-file ceiling, and it is
 * the branch that file used to inline: a `new-…` chat has no omp session, so it
 * renders from the client's own state and its composer is the one that can
 * defer a prompt. Keeping the two branches in one component is what let the
 * pending view drift behind the real one (same composer, different props).
 */

import type { Attachment, ChatMessageData, WorkspaceFolderData } from '@/shared/types';
import type { ApprovalMode } from '@/shared/lib/omp/config/access-mode';
import type { ForkPreview } from '@/client/hooks/chat/timeline/fork-preview';
import type { ComposerModes } from '@/client/components/workspace/chat-timeline/chat-input/modes-props';
import type { WaitingCandidate } from '@/client/components/workspace/chat-timeline/chat-input/WaitingDependencyPicker';
import type { DeferredModelStore } from '@/client/hooks/chat/timeline/deferred-model';
import { EmptyWorkspacePrompt } from '@/client/components/workspace/chat-timeline/EmptyWorkspacePrompt';
import type { SpawnTarget } from '@/client/hooks/chat/timeline/spawn-target';

export interface PendingChatViewProps {
  className: string;
  folders: WorkspaceFolderData[];
  selectedFolderId: number | null;
  setSelectedFolderId: (id: number | null) => void;
  rootPath: string | null;
  inputValue: string;
  setInputValue: (value: string) => void;
  inputAttachments: Attachment[];
  setInputAttachments: (attachments: Attachment[] | ((prev: Attachment[]) => Attachment[])) => void;
  onSend: (attachments: Attachment[], options?: { steering?: boolean }) => void;
  isGenerating: boolean;
  appSettings: Record<string, unknown>;
  messages: ChatMessageData[];
  provider?: string;
  providerNames?: Record<string, string>;
  modelName?: string;
  modelNames?: Record<string, string>;
  onThinkingLevelChange: (level: string) => void;
  onModelChange: (provider: string, modelId: string) => void;
  sessionModel: { provider: string; modelId: string } | null;
  sessionThinkingLevel?: string | null;
  accessMode: ApprovalMode;
  onAccessModeChange: (mode: ApprovalMode) => void;
  modes?: ComposerModes;
  composerModelRef: { current: { provider: string; modelId: string; thinkingLevel: string } | null };
  deferredComposerPickRef: DeferredModelStore;
  generatingVerb: string;
  variant: 'desktop' | 'mobile';
  onUndo?: (id: string, content?: string) => void;
  onRetry?: (id: string) => void;
  onNewChat?: (content: string, attachments?: Attachment[]) => void;
  streamStatusMap: Record<string, string | undefined>;
  titleForSession?: (id: string) => string | undefined;
  waitingFor: WaitingCandidate | null;
  onWaitingForChange: (candidate: WaitingCandidate | null) => void;
  heldWait: { title: string | null } | null;
  onCancelWait: () => void;
  /** Where the chat will run: the folder, or one of its worktrees. */
  spawnTarget?: SpawnTarget | null;
  onSpawnTargetChange?: (next: SpawnTarget | null) => void;
  /** The session this chat runs under, or null for a top-level chat. */
  parentSessionId?: string | null;
  onParentSessionChange?: (sessionId: string | null) => void;
  /** "Parent session" for a child, "Fork from" for a fork. */
  branchLabel?: string;
  branchAllowNone?: boolean;
  /**
   * The source transcript a FORK will carry, rendered above the composer so the
   * operator composes the first turn with the history it continues in sight. The
   * same prop keeps the branch picker reachable while the transcript is docked:
   * switching "Fork from" swaps the rows, because the composer has not sent yet.
   */
  branchPreview?: ForkPreview | null;
  onWorktreeReport?: (message: string) => void;
  /**
   * The harness this chat will spawn on, and the pick that writes it.
   *
   * This branch had neither, which is why a harness chosen in the model
   * dropdown's tab strip never reached the spawn: the picker changed its own
   * view and the server fell back to `omp-rpc`.
   */
  harness?: string;
  /** False once the prompt was dispatched: the harness already rode the spawn. */
  harnessEditable?: boolean;
  onSelectHarness?: (harness: string) => void;
}

export function PendingChatView(props: PendingChatViewProps) {
  return (
    <EmptyWorkspacePrompt
      className={props.className}
      folders={props.folders}
      selectedFolderId={props.selectedFolderId}
      setSelectedFolderId={props.setSelectedFolderId}
      rootPath={props.rootPath}
      inputValue={props.inputValue}
      setInputValue={props.setInputValue}
      inputAttachments={props.inputAttachments}
      setInputAttachments={props.setInputAttachments}
      onSend={props.onSend}
      isGenerating={props.isGenerating}
      appSettings={props.appSettings}
      messages={props.messages}
      provider={props.provider}
      providerNames={props.providerNames}
      modelName={props.modelName}
      modelNames={props.modelNames}
      onThinkingLevelChange={props.onThinkingLevelChange}
      onModelChange={props.onModelChange}
      accessMode={props.accessMode}
      onAccessModeChange={props.onAccessModeChange}
      modes={props.modes}
      composerModelRef={props.composerModelRef}
      deferredComposerPickRef={props.deferredComposerPickRef}
      sessionModel={props.sessionModel}
      sessionThinkingLevel={props.sessionThinkingLevel}
      generatingVerb={props.generatingVerb}
      variant={props.variant}
      onUndo={props.onUndo}
      onRetry={props.onRetry}
      onNewChat={props.onNewChat}
      streamStatusMap={props.streamStatusMap}
      titleForSession={props.titleForSession}
      waitingFor={props.waitingFor}
      onWaitingForChange={props.onWaitingForChange}
      heldWait={props.heldWait}
      onCancelWait={props.onCancelWait}
      spawnTarget={props.spawnTarget}
      onSpawnTargetChange={props.onSpawnTargetChange}
      parentSessionId={props.parentSessionId}
      onParentSessionChange={props.onParentSessionChange}
      branchLabel={props.branchLabel}
      branchAllowNone={props.branchAllowNone}
      {...(props.branchPreview ? { branchPreview: props.branchPreview } : {})}
      onWorktreeReport={props.onWorktreeReport}
      {...(props.harness ? { harness: props.harness } : {})}
      harnessEditable={props.harnessEditable}
      onSelectHarness={props.onSelectHarness}
    />
  );
}
