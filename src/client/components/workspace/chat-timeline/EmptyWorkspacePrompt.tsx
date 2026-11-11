import type { SetStateAction } from 'preact/compat';
import { useEffect, useMemo, useRef } from 'preact/hooks';
import type { Attachment, ChatMessageData, WorkspaceFolderData } from '@/shared/types';
import { ChatInput } from '@/client/components/workspace/chat-timeline/chat-input/index';
import { PendingTranscript } from '@/client/components/workspace/chat-timeline/PendingTranscript';
import { ComposerDockFrame } from '@/client/components/workspace/chat-timeline/ComposerDockFrame';
import { GeneratingIndicator } from '@/client/components/workspace/chat-timeline/GeneratingIndicator';
import type { ApprovalMode } from '@/shared/lib/omp/config/access-mode';
import {
  waitingCandidates,
  type WaitingCandidate,
} from '@/client/components/workspace/chat-timeline/chat-input/WaitingDependencyPicker';
import { Hourglass } from 'lucide-preact';
import { DraftTargetRow } from '@/client/components/workspace/chat-timeline/target-picker/DraftTargetRow';
import { ParentSessionPicker } from '@/client/components/workspace/chat-timeline/target-picker/ParentSessionPicker';
import type { SpawnTarget } from '@/client/hooks/chat/timeline/spawn-target';
import type { ForkPreview } from '@/client/hooks/chat/timeline/fork-preview';
import type { ToastTone } from '@/shared/lib/ui/toast-duration';

interface EmptyWorkspacePromptProps {
  className?: string;
  folders?: any[];
  selectedFolderId: number | null;
  setSelectedFolderId: (id: number | null) => void;
  inputValue: string;
  setInputValue: (v: string) => void;
  inputAttachments?: Attachment[];
  setInputAttachments?: (atts: SetStateAction<Attachment[]>) => void;
  onSend: (attachments: Attachment[]) => void;
  isGenerating: boolean;
  appSettings?: Record<string, any>;
  /** Messages of the pending session: rendered above the input so the
   *  optimistic user bubble shows immediately on send (before the omp spawn
   *  completes and the real session timeline takes over). Rendered in array
   *  order — no display-side reordering. */
  messages?: ChatMessageData[];
  provider?: string;
  providerNames?: Record<string, string>;
  modelName?: string;
  modelNames?: Record<string, string>;
  rootPath?: string | null;
  onThinkingLevelChange?: (level: string) => void;
  onModelChange?: (provider: string, modelId: string) => void;
  sessionModel?: { provider: string; modelId: string } | null;
  sessionThinkingLevel?: string | null;
  accessMode: ApprovalMode;
  onAccessModeChange: (mode: ApprovalMode) => void;
  /** Plan/goal slice. The pending view renders the SAME composer as the real
   *  timeline, so a mode set here survives adoption of the omp session. */
  modes?: import('@/client/components/workspace/chat-timeline/chat-input/modes-props').ComposerModes;
  composerModelRef: { current: { provider: string; modelId: string; thinkingLevel: string } | null };
  deferredComposerPickRef: { current: { provider?: string; modelId?: string; thinkingLevel?: string } | null };
  generatingVerb?: string;
  variant?: 'desktop' | 'mobile';
  /**
   * Row actions. The pending-session view renders the same rows as the real
   * timeline, so it must offer the same actions — without them the optimistic
   * turn's footer and its user bubble drew Retry / Undo / New-chat buttons that
   * did nothing until the omp session was adopted and this view was replaced.
   */
  onUndo?: (id: string, content?: string) => void;
  onRetry?: (id: string) => void;
  onNewChat?: (content: string, attachments?: Attachment[]) => void;
  /** Server-tracked `stream` ids: the only sessions the wait may name. */
  streamStatusMap?: Record<string, string | undefined>;
  /** A name for a streaming session the sidebar has not scanned yet. */
  titleForSession?: (id: string) => string | undefined;
  /**
   * Where this chat will run. The picker draws it and the send path reads it
   * through its own ref, so a worktree choice survives the remount a stretch or
   * a reload performs.
   */
  spawnTarget?: SpawnTarget | null;
  onSpawnTargetChange?: (next: SpawnTarget | null) => void;
  /** The session this chat runs UNDER, or null for a top-level chat. */
  parentSessionId?: string | null;
  onParentSessionChange?: (sessionId: string | null) => void;
  /** "Parent session" for a child, "Fork from" for a fork. */
  branchLabel?: string;
  branchAllowNone?: boolean;
  /**
   * The source transcript this FORK will carry.
   *
   * Present only for a fork that has not been created yet (the branch is built
   * on the first send), so it both draws the history above the composer and
   * marks the view as docked — which is what keeps the branch picker reachable
   * while switching "Fork from".
   */
  branchPreview?: ForkPreview | null;
  /** Reports a worktree the composer created or failed to create. */
  onWorktreeReport?: (message: string, tone?: ToastTone) => void;
  /** The "wait for session" pick, persisted per chat. */
  waitingFor?: WaitingCandidate | null;
  onWaitingForChange?: (candidate: WaitingCandidate | null) => void;
  /** A held prompt for THIS chat: the composer is disabled until it is released
   *  or cancelled, because there is no session to send a second prompt to. */
  heldWait?: { title: string | null } | null;
  onCancelWait?: () => void;
  /** The harness this chat will spawn on, and the pick that writes it. */
  harness?: string;
  /** False once the prompt was dispatched: the harness already rode the spawn. */
  harnessEditable?: boolean;
  onSelectHarness?: (harness: string) => void;
}

export function EmptyWorkspacePrompt({
  className = '',
  folders = [],
  selectedFolderId,
  setSelectedFolderId,
  inputValue,
  setInputValue,
  inputAttachments,
  setInputAttachments,
  onSend,
  isGenerating,
  appSettings = {},
  messages = [],
  provider,
  providerNames,
  modelName,
  modelNames,
  rootPath,
  onThinkingLevelChange,
  onModelChange,
  sessionModel,
  sessionThinkingLevel,
  accessMode,
  onAccessModeChange,
  modes,
  composerModelRef,
  deferredComposerPickRef,
  generatingVerb,
  variant = 'desktop',
  onUndo,
  onRetry,
  onNewChat,
  streamStatusMap = {},
  titleForSession,
  spawnTarget = null,
  onSpawnTargetChange,
  parentSessionId = null,
  onParentSessionChange,
  branchLabel,
  branchAllowNone,
  branchPreview = null,
  onWorktreeReport,
  waitingFor = null,
  onWaitingForChange,
  heldWait = null,
  onCancelWait,
  harness,
  harnessEditable = true,
  onSelectHarness,
}: EmptyWorkspacePromptProps) {
  const timelineRef = useRef<HTMLDivElement>(null);

  // Sessions the wait may name: the ones with a run in flight, from the same
  // server-tracked map the sidebar's spinner is drawn from.
  const candidates = useMemo(
    () => waitingCandidates(folders, streamStatusMap, null, titleForSession),
    [folders, streamStatusMap, titleForSession],
  );

  // The rows the fork will carry, above the composer. A fork is composed on an
  // empty `new-…` chat, so without this the operator chose the branch's first
  // turn with none of the history it continues in sight.
  const previewLength = branchPreview?.messages.length ?? 0;

  useEffect(() => {
    if (timelineRef.current) {
      timelineRef.current.scrollTop = timelineRef.current.scrollHeight;
    }
  }, [messages.length, previewLength]);

  const isMobile = variant === 'mobile';
  // A chat with rows to show (or a prompt in flight) draws the SAME dock the
  // real timeline does. It used to keep this page's centred `p-8` column and a
  // `space-y-3` stack, so the generating indicator — and the composer under it
  // — sat 28px higher while the spawn was in flight (`Loading…`, 141px from the
  // pane's bottom) than once the run streamed in the real timeline
  // (`Thinking…`, 113px). The row jumped at the moment the chat was adopted,
  // which read as two different indicators.
  //
  // A fork's preview docks from the FIRST frame, with or without rows: the
  // "Fork from" picker must stay reachable while the source is being changed,
  // and it lives in the docked branch.
  const docked = messages.length > 0 || isGenerating || Boolean(branchPreview);

  const heldPrompt = heldWait ? (
    <div className="flex items-center gap-2 rounded-lg border border-ink/15 bg-ink/[0.03] px-3 py-2 text-xs text-ink/70">
      <Hourglass size={12} className="shrink-0 animate-pulse text-ink/60" />
      <span className="min-w-0 flex-1 truncate">
        Waiting for {heldWait.title ?? 'another session'} to finish before this prompt is sent.
      </span>
      {onCancelWait && (
        <button
          type="button"
          data-testid="cancel-held-prompt"
          onClick={onCancelWait}
          className="shrink-0 rounded border border-ink/20 px-2 py-0.5 text-[11px] text-ink/70 hover:bg-ink/5 hover:text-ink cursor-pointer"
        >
          Cancel
        </button>
      )}
    </div>
  ) : null;

  const composer = (
    <ChatInput
      value={inputValue}
      onChange={setInputValue}
      rootPath={rootPath}
      attachments={inputAttachments}
      onAttachmentsChange={setInputAttachments}
      onSend={onSend}
      isGenerating={isGenerating}
      disabled={!selectedFolderId || Boolean(heldWait)}
      className="w-full shrink-0"
      appSettings={appSettings}
      onThinkingLevelChange={onThinkingLevelChange}
      onModelChange={onModelChange}
      sessionModel={sessionModel}
      sessionThinkingLevel={sessionThinkingLevel}
      accessMode={accessMode}
      onAccessModeChange={onAccessModeChange}
      modes={modes}
      composerModelRef={composerModelRef}
      deferredComposerPickRef={deferredComposerPickRef}
      {...(harness ? { harness } : {})}
      harnessEditable={harnessEditable}
      {...(onSelectHarness ? { onSelectHarness } : {})}
      variant={variant}
      expandable
      // A brand-new chat has no turns: the `stage` composer style draws its
      // wider, taller card here and nowhere else. A fork's preview is history,
      // so its composer docks like any chat that already has rows.
      hero={messages.length === 0 && previewLength === 0}
    />
  );

  return (
    <div
      className={`flex flex-col h-full bg-canvas ${docked ? '' : isMobile ? 'px-3 py-4' : 'p-8'} ${className}`}
      style={!docked && isMobile ? { paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))' } : undefined}
    >
      {docked ? (
        <>
          {/* A fork is composed, not created: the source it branches from is
              still switchable, so its picker stays above the transcript the
              preview draws. Every other pending chat loses the row once docked
              because its first send already dispatched the spawn. */}
          {branchPreview && onParentSessionChange && (
            <div className={`shrink-0 flex items-center gap-1 flex-wrap ${isMobile ? 'pl-4 pr-3 pt-3' : 'px-4 pt-3'}`}>
              <ParentSessionPicker
                folders={folders as WorkspaceFolderData[]}
                value={parentSessionId}
                onChange={onParentSessionChange}
                label={branchLabel ?? 'Fork from'}
                allowNone={branchAllowNone ?? false}
              />
            </div>
          )}
          {/* The pending transcript reserves the box the real timeline's own
              scroller does (`TimelineBody`), so adoption moves no text either. */}
          <div
            ref={timelineRef}
            className={`flex-1 min-h-0 overflow-y-auto scroll-smooth overscroll-contain ${
              isMobile ? 'pl-4 pr-3 py-3 pb-8' : 'p-4 pb-10'
            }`}
          >
            <PendingTranscript
              messages={messages}
              preview={branchPreview}
              isGenerating={isGenerating}
              isMobile={isMobile}
              {...(provider ? { provider } : {})}
              {...(providerNames ? { providerNames } : {})}
              {...(modelName ? { modelName } : {})}
              {...(modelNames ? { modelNames } : {})}
              sessionThinkingLevel={sessionThinkingLevel}
              {...(harness ? { harness } : {})}
              {...(onUndo ? { onUndo } : {})}
              {...(onRetry ? { onRetry } : {})}
              {...(onNewChat ? { onNewChat } : {})}
            />
          </div>

          {/* One frame with the real dock (`ComposerDock`), so the indicator and
              the composer cannot sit at two different heights. */}
          <ComposerDockFrame isMobile={isMobile}>
            {isGenerating && (
              <GeneratingIndicator
                modelName={modelName}
                generatingVerb={generatingVerb}
                provider={provider}
                providerNames={providerNames}
                {...(harness ? { harness } : {})}
              />
            )}
            {heldPrompt}
            {composer}
          </ComposerDockFrame>
        </>
      ) : (
        <div className="chat-column flex flex-col min-h-0 my-auto justify-center space-y-3">
          {/* Workspace Selection Seamless Dropdown (No border, transparent
              background). A chat with rows keeps its target and drops the
              picker; this branch is only the chat that has not started. */}
          <DraftTargetRow
            folders={folders as WorkspaceFolderData[]}
            selectedFolderId={selectedFolderId}
            setSelectedFolderId={setSelectedFolderId}
            spawnTarget={spawnTarget}
            onSpawnTargetChange={onSpawnTargetChange}
            onWorktreeReport={onWorktreeReport}
            parentSessionId={parentSessionId}
            onParentSessionChange={onParentSessionChange}
            branchLabel={branchLabel}
            branchAllowNone={branchAllowNone}
            waitingFor={waitingFor}
            onWaitingForChange={onWaitingForChange}
            streamStatusMap={streamStatusMap}
            titleForSession={titleForSession}
            candidates={candidates}
          />
          {/* A held prompt owns this chat until it is released: there is no
              session to send a second prompt to, and a composer that looked live
              would accept one that could not be delivered. */}
          {heldPrompt}
          {composer}
        </div>
      )}
    </div>
  );
}
