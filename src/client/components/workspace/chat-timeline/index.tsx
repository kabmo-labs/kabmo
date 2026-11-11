import { useCallback, useMemo } from 'preact/hooks';
import { useSearchParams } from '@/client/lib/router/search-params';
import { AskFramesContext, splitAskFrames, type AskFramesHandle } from '@/client/hooks/chat/timeline/ask-frames';
import type { ExtensionUiDialogRequest } from '@/shared/types/omp/agent';
import type { UserTurnRef } from '@/shared/types/chat';
import type { ExtensionDialogResponse } from '@/client/components/workspace/chat-timeline/tool-renderers/extension-dialog/Lazy';
import { PendingChatView } from '@/client/components/workspace/chat-timeline/PendingChatView';
import { SessionSkeleton } from '@/client/components/workspace/chat-timeline/SessionSkeleton';
import { SubagentView } from '@/client/components/workspace/chat-timeline/SubagentView';
import { TimelineBody } from '@/client/components/workspace/chat-timeline/TimelineBody';
import { ComposerDock } from '@/client/components/workspace/chat-timeline/ComposerDock';
import { useChatTimeline } from '@/client/hooks/chat/timeline';
import { useSessionTitle } from '@/client/hooks/chat/timeline/session-title';
import { useSubagentView } from '@/client/hooks/chat/timeline/subagent-view';
import { useUndoConfirmation } from '@/client/hooks/chat/timeline/undo-confirmation';
import { usePendingBranch } from '@/client/hooks/chat/timeline/pending-branch';
import { useForkPreview } from '@/client/hooks/chat/timeline/fork-preview';
import { useForkSession } from '@/client/hooks/chat/timeline/use-fork-session';
import { useStopWithQueuedPrompts } from '@/client/hooks/chat/timeline/stop-with-queue';
import { useModelNames } from '@/client/hooks/models/use-model-names';
import { useRunIdentity } from '@/client/hooks/chat/timeline/run-identity';
import { useProviderNames } from '@/client/hooks/models/use-provider-names';
import { useToasts } from '@/client/hooks/ui/toasts';
import { ChatOverlays } from '@/client/components/workspace/chat-timeline/ChatOverlays';
import { composerRootFor } from '@/shared/lib/workspace/active-project';
import { usePendingProjectModel } from '@/client/hooks/chat/timeline/pending-model';
import { useNewChatOpen } from '@/client/hooks/chat/timeline/new-chat-open';
import { useSidebarData } from '@/client/hooks/chat/omp/session-list';
import { useHeldWait } from '@/client/hooks/chat/waiting/held';
import { useSessionHarness } from '@/client/hooks/chat/timeline/session-harness';

interface ChatTimelineProps {
  className?: string;
  appSettings?: Record<string, any>;
  onSessionTitle?: (title: string | null) => void;
  /**
   * `mobile` tightens the outer padding, swaps the minimap rail for the
   * tap-sized turn list (a 1px-per-turn rail cannot be aimed at with a
   * finger) and hands the composer a touch-sized layout. Everything else — the
   * omp agent bridge, queue, steering, subagents, ask dialogs — is identical.
   */
  variant?: 'desktop' | 'mobile';
}

export function ChatTimeline({ className = '', appSettings = {}, onSessionTitle, variant = 'desktop' }: ChatTimelineProps) {
  const { folders, streamStatusMap, titleHint } = useSidebarData();
  const isMobile = variant === 'mobile';
  const { pushToast } = useToasts();
  const {
    sessionId,
    selectedFolderId,
    setSelectedFolderId,
    sessionData,
    localMessages,
    isGenerating,
    timelineRunning,
    hasMore,
    loadingOlder, loadOlderError, sessionLoading,
    loadOlder,
    userTurns,
    jumpingTurn,
    jumpToUserTurn,
    generatingVerb,
    messageQueue,
    removeMessage,
    reorderMessages,
    inputValue,
    setInputValue,
    inputAttachments,
    setInputAttachments,
    scrollNodeRef,
    contentRef,
    rowWindow,
    showScrollBottom,
    readingBack,
    handleScroll,
    jumpToBottom,
    handleSend,
    handleEditQueueItem,
    handleSendNowQueueItem,
    handleUndo,
    handleRetry,
    submitNewChat,
    stopGenerating,
    handleThinkingLevelChange,
    handleModelChange,
    accessMode,
    handleAccessModeChange,
    modes,
    planReview,
    composerModelRef,
    deferredComposerPickRef,
    waitingDependency,
    extensionDialogs,
    resolveExtensionDialog,
    respondToExtensionUi,
    spawnTarget,
    setSpawnTarget,
    pendingHarnessRef,
  } = useChatTimeline({ folders, streamStatusMap, appSettings, reportActionError: pushToast });

  const activeHarness = useSessionHarness(folders, sessionId, localMessages.length, pendingHarnessRef);
  // Ask dialogs render on their own tool card; anything else the agent is
  // blocked on (an approval gate, an extension picker) has no card and keeps
  // the modal. It also waits for committed history: a replayed dialog has no
  // card to match yet, and deciding early flashed the modal and withdrew it.
  const { framesByTool, orphanAsks, modalRequest } = useMemo(
    () => splitAskFrames(localMessages, extensionDialogs, !sessionLoading),
    [localMessages, extensionDialogs, sessionLoading],
  );
  const respondToFrame = useCallback((request: ExtensionUiDialogRequest, response: ExtensionDialogResponse) => {
    void respondToExtensionUi(request, response);
    resolveExtensionDialog(request.id);
  }, [respondToExtensionUi, resolveExtensionDialog]);
  const askFrames = useMemo<AskFramesHandle>(
    () => ({ framesByTool, orphanAsks, respond: respondToFrame }),
    [framesByTool, orphanAsks, respondToFrame],
  );

  const newChat = useNewChatOpen({ folders, sessionId, selectedFolderId, ...(activeHarness.harness ? { harness: activeHarness.harness } : {}) });
  const { pendingUndo, undoing, error: undoError, requestUndo: handleRequestUndo, closeUndoConfirm, confirmUndo } = useUndoConfirmation(handleUndo);
  const [searchParams, setSearchParams] = useSearchParams();

  // Stop-all semantics: the run stops AND the queued follow-ups stay in the
  // panel (the auto-process holds off); the toast offers the head item.
  const handleStop = useStopWithQueuedPrompts(stopGenerating, messageQueue, handleSendNowQueueItem, pushToast);
  const { activeSubagent, back: handleSubagentBack } = useSubagentView(
    sessionId,
    searchParams.get('subagent'),
    setSearchParams,
  );

  useSessionTitle(sessionId, sessionData?.title, onSessionTitle);

  const handleJumpTurn = useCallback((turn: UserTurnRef) => {
    void jumpToUserTurn(turn.id, turn.index);
  }, [jumpToUserTurn]);

  const handleNewChat = newChat.open;
  const modelNames = useModelNames();
  const { sessionProvider, sessionModelName } = useRunIdentity({ folders, sessionId, sessionData, modelNames });
  const providerNames = useProviderNames();

  // A pending "new-…" chat has no messages yet, so the workspace picker stays
  // available until the first send spawns the real session.
  const isPendingSession = Boolean(sessionId?.startsWith('new-'));

  const { heldWait, cancelHeldWait } = useHeldWait(sessionId, isPendingSession, pushToast);
  const composerRoot = composerRootFor(folders, sessionId, selectedFolderId);
  // The workspace's own default model, resolved by the same rule the spawn
  // uses, so the pending composer's pill does not promise Kabmo's global pick.
  const pendingProjectModel = usePendingProjectModel(folders, selectedFolderId);
  const sessionDataModel = typeof sessionData?.model === 'object' ? sessionData.model : null;
  const branch = usePendingBranch({ sessionId, folders, selectedFolderId, setSelectedFolderId, urlParentId: searchParams.get('parentSessionId'), urlForkFrom: searchParams.get('forkFrom'), urlForkAt: searchParams.get('forkAt'), setSearchParams, harnessPicker: activeHarness.picker, pendingHarnessRef });
  const fork = useForkSession(sessionId, folders, selectedFolderId);
  // A fork's source transcript, drawn above the pending composer and reloaded
  // when "Fork from" moves to another session.
  const forkPreview = useForkPreview(branch.forkSourceSessionId, branch.forkAnchorEntryId);

  // The chat-level "a run is in flight" flag is computed in `useChatTimeline`
  // (it owns the queue-vs-send decision that depends on it) and consumed here
  // for the indicator, the streaming row and the withheld run footer, so the
  // two cannot disagree.

  // Full-panel skeleton while a session's committed history is still loading:
  // covers the whole chat timeline (body + composer) so a session switch shows
  // one coherent placeholder instead of a half-drawn view. Skipped while an
  // optimistic send owns the tail (fresh spawn adoption must keep its bubbles).
  const showFullSkeleton = !isPendingSession && sessionLoading && localMessages.length === 0;

  if (!sessionId || isPendingSession) {
    return (
      <PendingChatView
        className={className}
        folders={folders}
        selectedFolderId={selectedFolderId}
        setSelectedFolderId={setSelectedFolderId}
        rootPath={composerRoot}
        inputValue={inputValue}
        setInputValue={setInputValue}
        inputAttachments={inputAttachments}
        setInputAttachments={setInputAttachments}
        onSend={handleSend}
        isGenerating={timelineRunning}
        appSettings={appSettings}
        messages={localMessages}
        provider={sessionProvider}
        providerNames={providerNames}
        modelName={sessionModelName}
        modelNames={modelNames}
        onThinkingLevelChange={handleThinkingLevelChange}
        onModelChange={handleModelChange}
        accessMode={accessMode}
        onAccessModeChange={handleAccessModeChange}
        modes={modes}
        composerModelRef={composerModelRef}
        deferredComposerPickRef={deferredComposerPickRef}
        sessionModel={branch.parentModel ?? sessionDataModel ?? pendingProjectModel}
        sessionThinkingLevel={sessionData?.thinkingLevel}
        generatingVerb={generatingVerb}
        variant={variant}
        onUndo={handleRequestUndo}
        onRetry={handleRetry}
        onNewChat={handleNewChat}
        streamStatusMap={streamStatusMap}
        titleForSession={titleHint}
        waitingFor={waitingDependency.value}
        onWaitingForChange={waitingDependency.set}
        heldWait={heldWait ? { title: heldWait.dependsOnTitle } : null}
        onCancelWait={cancelHeldWait}
        spawnTarget={spawnTarget}
        onSpawnTargetChange={setSpawnTarget}
        {...branch.viewProps}
        {...(branch.forkSourceSessionId ? { branchPreview: forkPreview } : {})}
        onWorktreeReport={(message, tone) => pushToast(message, tone ?? 'success', { duration: 6000 })}
        {...branch.composerProps}
      />
    );
  }

  return (
    <AskFramesContext.Provider value={askFrames}>
      <div className={`flex flex-col h-full min-h-0 overflow-hidden bg-canvas relative ${className}`}>
        {showFullSkeleton ? (
          <SessionSkeleton />
        ) : (
          <>
            {/* Main chat container wrapper */}
            <div className="relative flex-1 min-h-0 flex flex-col">
              {activeSubagent ? (
                <SubagentView
                  sessionId={sessionId}
                  subagent={activeSubagent}
                  onBack={handleSubagentBack}
                  provider={sessionProvider}
                  providerNames={providerNames}
                  {...(activeHarness.harness ? { harness: activeHarness.harness } : {})}
                  isMobile={isMobile}
                />
              ) : (
                <TimelineBody
                  isMobile={isMobile}
                  userTurns={userTurns}
                  jumpingTurn={jumpingTurn}
                  onJumpTurn={handleJumpTurn}
                  scrollNodeRef={scrollNodeRef}
                  contentRef={contentRef}
                  handleScroll={handleScroll}
                  loadingOlder={loadingOlder}
                  hasMore={hasMore}
                  loadOlderError={loadOlderError}
                  loadOlder={loadOlder}
                  messages={localMessages}
                  isGenerating={timelineRunning}
                  provider={sessionProvider}
                  providerNames={providerNames}
                  modelName={sessionModelName}
                  modelNames={modelNames}
                  thinkingLevel={sessionData?.thinkingLevel}
                  {...(activeHarness.harness ? { harness: activeHarness.harness } : {})}
                  onUndo={handleRequestUndo}
                  onRetry={handleRetry}
                  onNewChat={handleNewChat}
                  onFork={fork}
                  showScrollBottom={showScrollBottom}
                  jumpToBottom={jumpToBottom}
                  rowWindow={rowWindow}
                />
              )}
            </div>

            {/* Input Area Footer with Docked Generating Indicator (Seamless & Transparent) */}
            {!activeSubagent && (
              <ComposerDock
                isMobile={isMobile}
                sessionId={sessionId}
                isGenerating={isGenerating}
                showGeneratingIndicator={timelineRunning}
                modelName={sessionModelName}
                generatingVerb={generatingVerb}
                provider={sessionProvider}
                providerNames={providerNames}
                messageQueue={messageQueue}
                onRemoveQueueItem={removeMessage}
                onReorderQueue={reorderMessages}
                onEditQueueItem={handleEditQueueItem}
                onSendNowQueueItem={handleSendNowQueueItem}
                inputValue={inputValue}
                setInputValue={setInputValue}
                rootPath={composerRoot}
                attachments={inputAttachments}
                setAttachments={setInputAttachments}
                onSend={handleSend}
                onStop={handleStop}
                appSettings={appSettings}
                onThinkingLevelChange={handleThinkingLevelChange}
                onModelChange={handleModelChange}
                accessMode={accessMode}
                onAccessModeChange={handleAccessModeChange}
                modes={modes}
                composerModelRef={composerModelRef}
                deferredComposerPickRef={deferredComposerPickRef}
                sessionModel={typeof sessionData?.model === 'object' ? sessionData.model : null}
                sessionThinkingLevel={sessionData?.thinkingLevel}
                {...activeHarness.picker}
                variant={variant}
                // The same scroll geometry that draws the scroll-to-bottom
                // button, with hysteresis: the reader is back through the
                // transcript, so a phone composer may give its height back.
                // `composerExpansion` ignores it on a desktop.
                shrinkWhileReading={readingBack}
                // No turns yet: the `stage` composer style draws its wider,
                // taller card only here.
                hero={localMessages.length === 0 && !timelineRunning}
              />
            )}
          </>
        )}

        <ChatOverlays
          pendingUndo={pendingUndo}
          undoing={undoing}
          undoError={undoError}
          onCloseUndo={closeUndoConfirm}
          onConfirmUndo={confirmUndo}
          isOmpSession={Boolean(sessionId) && !sessionId.startsWith('new-') && Number.isNaN(Number(sessionId))}
          newChatInitialContent={newChat.content}
          newChatInitialAttachments={newChat.attachments}
          newChatHarness={newChat.harness}
          onCloseNewChat={newChat.close}
          onSendNewChat={submitNewChat}
          appSettings={appSettings}
          accessMode={accessMode}
          onAccessModeChange={handleAccessModeChange}
          composerModelRef={composerModelRef}
          modalRequest={modalRequest}
          onRespondToFrame={respondToFrame}
          planReview={planReview}
        />

      </div>
    </AskFramesContext.Provider>
  );
}
