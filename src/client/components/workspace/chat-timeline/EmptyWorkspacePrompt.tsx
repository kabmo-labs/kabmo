import type { SetStateAction } from 'preact/compat';
import { Fragment } from 'preact';
import { useEffect, useMemo, useRef } from 'preact/hooks';
import type { Attachment, ChatMessageData, WorkspaceFolderData } from '@/shared/types';
import { ChatInput } from '@/client/components/workspace/chat-timeline/chat-input/index';
import { ChatMessageItem } from '@/client/components/workspace/chat-timeline/MessageItem';
import { RunFooter } from '@/client/components/workspace/chat-timeline/RunFooter';
import { ComposerDockFrame } from '@/client/components/workspace/chat-timeline/ComposerDockFrame';
import { GeneratingIndicator } from '@/client/components/workspace/chat-timeline/GeneratingIndicator';
import { resolveRunFooters, streamingRowIndex } from '@/shared/lib/chat/timeline/run-footer';
import type { ApprovalMode } from '@/shared/lib/omp/config/access-mode';
import {
  WaitingDependencyPicker,
  waitingCandidates,
  type WaitingCandidate,
} from '@/client/components/workspace/chat-timeline/chat-input/WaitingDependencyPicker';
import { Hourglass } from 'lucide-preact';
import { WorkspacePicker } from '@/client/components/workspace/chat-timeline/target-picker/WorkspacePicker';
import { WorktreePicker } from '@/client/components/workspace/chat-timeline/target-picker/WorktreePicker';
import type { SpawnTarget } from '@/client/hooks/chat/timeline/spawn-target';

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
  /** Reports a worktree the composer created or failed to create. */
  onWorktreeReport?: (message: string) => void;
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

  // Run footers are boundary rows: emitted after the run's last row, so a
  // trailing notice never separates the footer from the next user message.
  const { streamingIdx, footers } = useMemo(
    () => ({
      streamingIdx: streamingRowIndex(messages),
      footers: resolveRunFooters(messages, isGenerating),
    }),
    [messages, isGenerating],
  );

  useEffect(() => {
    if (timelineRef.current) {
      timelineRef.current.scrollTop = timelineRef.current.scrollHeight;
    }
  }, [messages.length]);

  const isMobile = variant === 'mobile';
  // A chat with rows to show (or a prompt in flight) draws the SAME dock the
  // real timeline does. It used to keep this page's centred `p-8` column and a
  // `space-y-3` stack, so the generating indicator — and the composer under it
  // — sat 28px higher while the spawn was in flight (`Loading…`, 141px from the
  // pane's bottom) than once the run streamed in the real timeline
  // (`Thinking…`, 113px). The row jumped at the moment the chat was adopted,
  // which read as two different indicators.
  const docked = messages.length > 0 || isGenerating;

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
      // wider, taller card here and nowhere else.
      hero={messages.length === 0}
    />
  );

  return (
    <div
      className={`flex flex-col h-full bg-canvas ${docked ? '' : isMobile ? 'px-3 py-4' : 'p-8'} ${className}`}
      style={!docked && isMobile ? { paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))' } : undefined}
    >
      {docked ? (
        <>
          {/* The pending transcript reserves the box the real timeline's own
              scroller does (`TimelineBody`), so adoption moves no text either. */}
          <div
            ref={timelineRef}
            className={`flex-1 min-h-0 overflow-y-auto scroll-smooth overscroll-contain ${
              isMobile ? 'pl-4 pr-3 py-3 pb-8' : 'p-4 pb-10'
            }`}
          >
            <div className="chat-column">
              {messages.map((msg, idx) => {
                const prev = messages[idx - 1];
                const isLoading = isGenerating && idx === streamingIdx && msg.role === 'ai';
                const isAiFragment = msg.role !== 'user' && prev && prev.role !== 'user';
                const footer = footers[idx];
                return (
                  <Fragment key={msg.id}>
                    <ChatMessageItem
                      msg={msg}
                      isStreaming={isLoading}
                      onUndo={onUndo}
                      onNewChat={onNewChat}
                      isMobile={isMobile}
                      className={isAiFragment ? 'mt-1' : 'mt-8'}
                    />
                    {footer && (
                      <RunFooter
                        msg={footer.msg}
                        provider={provider}
                        providerNames={providerNames}
                        modelName={modelName}
                        modelNames={modelNames}
                        thinkingLevel={sessionThinkingLevel ?? undefined}
                        {...(harness ? { harness } : {})}
                        durationMs={footer.durationMs}
                        answerText={footer.answerText}
                        retryTargetId={footer.runUserId}
                        onRetry={onRetry}
                        onNewChat={onNewChat}
                      />
                    )}
                  </Fragment>
                );
              })}
            </div>
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
          <div className="flex items-center gap-1 flex-wrap">
            {/* Two controls, because they answer two questions: the workspace
                (which project) and the worktree (which checkout of it). The
                worktree control draws itself only for a git repository, and it
                reads its list on mount because its own trigger names the branch
                the project root holds. */}
            <WorkspacePicker
              folders={folders as WorkspaceFolderData[]}
              selectedFolderId={selectedFolderId}
              setSelectedFolderId={setSelectedFolderId}
              onClearWorktree={() => onSpawnTargetChange?.(null)}
            />
            {onSpawnTargetChange && (
              <WorktreePicker
                folders={folders as WorkspaceFolderData[]}
                selectedFolderId={selectedFolderId}
                target={spawnTarget}
                setTarget={onSpawnTargetChange}
                onReport={onWorktreeReport}
              />
            )}
            {/* The wait picker sits BESIDE the workspace picker, because both
                answer the same question about the chat that has not started:
                where it runs, and what it waits for. It only appears while
                there is something to wait for (or a pick already made). */}
            {onWaitingForChange && (waitingFor || candidates.length > 0) && (
              <WaitingDependencyPicker
                folders={folders}
                streamStatusMap={streamStatusMap}
                sessionId={null}
                titleFor={titleForSession}
                value={waitingFor}
                onChange={onWaitingForChange}
              />
            )}
          </div>
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
