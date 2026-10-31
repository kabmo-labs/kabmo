import { useCallback, useRef, useState } from 'preact/hooks';
import { useTimelineScope } from '@/client/hooks/chat/timeline/scope';
import { useSpawnTarget } from '@/client/hooks/chat/timeline/spawn-target';
import type { ChatMessageData } from '@/shared/types';
import { useOmpAgent } from '@/client/hooks/chat/omp';
import { useChatTimelineQueue } from '@/client/hooks/chat/timeline/queue';
import { useExtensionDialogQueue } from '@/client/hooks/chat/timeline/extension-dialog';
import { useChatTimelineScroll } from '@/client/hooks/chat/timeline/scroll';
import { useGeneratingState } from '@/client/hooks/chat/timeline/generating';
import { useTimelineAutoScroll } from '@/client/hooks/chat/timeline/auto-scroll';
import { useChatTimelineActions } from '@/client/hooks/chat/timeline/actions';
import { useChatTimelineSend } from '@/client/hooks/chat/timeline/send';
import { useSessionLoad } from '@/client/hooks/chat/timeline/session-load';
import { useTimelineJumpRail } from '@/client/hooks/chat/timeline/jump-rail';
import { createOmpAgentCallbacks } from '@/shared/lib/chat/timeline/omp-callbacks';
import { cancelStreamingCoalescer } from '@/shared/lib/chat/timeline/stream-coalescer';
import { useChatTimelineAccessMode } from '@/client/hooks/chat/timeline/access-mode';
import { useComposerModes } from '@/client/hooks/chat/timeline/composer-modes';
import { useComposerDraft } from '@/client/hooks/chat/composer/use-draft';
import { isChatRunning, isSessionStreaming } from '@/client/hooks/chat/omp/session-statuses';
import { useWaitingDependencyChoice } from '@/client/hooks/chat/waiting/choice';
import { useComposerRefs } from '@/client/hooks/chat/timeline/composer-refs';

interface UseChatTimelineOptions {
  folders?: any[];
  /** The authoritative `sessionId → streamStatus` map from the sidebar's
   *  `sidebar:status` topic — the only source of "a run is in flight". */
  streamStatusMap?: Record<string, 'stream' | 'finish' | 'abort'>;
  appSettings?: Record<string, any>;
  /** Where a failed footer action (rewind refused, send rejected) is reported.
   *  Defaults to the console; a caller with a toast stack passes one in. */
  reportActionError?: (message: string) => void;
}

export function useChatTimeline({
  folders = [],
  streamStatusMap = {},
  appSettings = {},
  reportActionError = (message: string) => console.error(message),
}: UseChatTimelineOptions = {}) {
  const { sessionId, folderId, selectedFolderId, selectContextFolder, setSearchParams } = useTimelineScope();
  // Plan/goal toggles plus the plan-review surface. PER SESSION, unlike the
  // access mode: they describe what this conversation is doing, and one hook
  // returns both halves because a mode command can produce a proposal.
  const { modes, planReview } = useComposerModes(sessionId);

  // Ref mirror of loadOlder so the scroll handler can call the latest one
  // without re-creating it (useSessionLoad is defined below the scroll hook).
  const loadOlderRef = useRef<() => void>(() => {});

  const scroll = useChatTimelineScroll({ onScrollTop: () => loadOlderRef.current() });
  const { scrollRef, scrollNodeRef, contentRef, showScrollBottom, readingBack, handleScroll, scrollToBottom, jumpToBottom, jumpActiveRef, jumpCountRef } = scroll;

  const { inputValue, setInputValue, inputAttachments, setInputAttachments } = useComposerDraft();
  const [localMessages, setLocalMessages] = useState<ChatMessageData[]>([]);

  // A pending "new-…" session renders the workspace picker with its own timeline.
  const isPendingSession = Boolean(sessionId?.startsWith('new-'));
  // Committed history lands asynchronously (session-load.ts), so the container
  // paints at the top first; jump to the tail once per session when it does.
  // Unconditional: follow mode is this view's, not the opened session's.
  useTimelineAutoScroll({
    sessionId,
    messages: localMessages,
    scrollRef,
    jumpToBottom,
    enabled: !isPendingSession,
  });

  const {
    isGenerating,
    isGeneratingRef,
    ownRun,
    ownRunRef,
    streamRunRef,
    setGenerating,
    generatingVerb,
    activityRef,
    setGeneratingVerb,
  } = useGeneratingState();
  const localMessagesRef = useRef<ChatMessageData[]>([]);
  localMessagesRef.current = localMessages;
  const abortControllerRef = useRef<AbortController | null>(null);
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  // Armed by Stop so a stopped run does NOT trigger the next queued item
  // (stop-all semantics); disarmed by any explicit send.
  const stopHoldRef = useRef(false);
  // Fire the metadata refresh once per session when the AI starts responding
  // (agent_start = first chunk): the omp JSONL now carries the user turn, so
  // the sidebar item + real title appear immediately.
  const metaRefreshedRef = useRef<string | null>(null);
  // Optimistic user bubble awaiting omp's echo (reconciled by the callbacks).
  const optimisticUserIdRef = useRef<string | null>(null);
  // Raw composer text for steer/follow-up echoes (those paths have no bubble).
  const pendingUserDisplaysRef = useRef<{ sent: string; display: string }[]>([]);

  // omp sessions are string UUIDs; Kabmo-created (mock/numeric) sessions are
  // integers, and a pending client-side "new-…" has no omp session yet — so
  // only a UUID routes through the live agent bridge.
  const isOmpSession = Boolean(sessionId) && !String(sessionId).startsWith('new-') && Number.isNaN(Number(sessionId));

  // One "a run is in flight" state for the whole chat, and its base is the
  // SERVER: the `stream` row written at prompt dispatch, published on the
  // `sidebar:status` topic the sidebar's spinner is drawn from — so no consumer
  // of this flag (indicator, streaming row, withheld run footer, queue-vs-send,
  // Stop) can disagree with the sidebar.
  //
  // Two windows the row cannot cover, and BOTH must be reported or a run reads
  // as already settled while it is still starting: (1) a pending `new-…` chat
  // has no omp id until the spawn answers, so no row can ever carry it; (2) a
  // run THIS PAGE dispatched, in the beat between the send arming the optimistic
  // rows and the row reaching this client over the topic — measured ~120-250 ms,
  // and the reason the run footer "appeared for an instant" on every prompt:
  // handed `isGenerating: false` for that window, `resolveRunFooters` settled the
  // run and painted a model/duration footer over the EMPTY placeholder row, then
  // withdrew it when the row arrived.
  //
  // The second term is `ownRun` — armed by the SEND path alone, released by the
  // same settle paths as the run — NOT the raw local flag: an ADOPTED run (the
  // mount probe resuming a live run's UI) leaves it alone, so a run this page did
  // not start is still reported by the server row and never by client state.
  const timelineRunning = isChatRunning(streamStatusMap, sessionId, ownRun);

  // SERVER evidence a prompt was dispatched (the `stream` row), mirrored for
  // the reconnect guard: a run whose FIRST frame was lost has no `agent_start`.
  const serverRunRef = useRef(isSessionStreaming(streamStatusMap, sessionId));
  serverRunRef.current = isSessionStreaming(streamStatusMap, sessionId);

  const aiPlaceholderIdRef = useRef<string | null>(null);

  const {
    sessionData,
    adoptedSessionIdRef, refreshSessionMeta, seedSession, reloadMessages, needsReloadRef,
    hasMore,
    loadingOlder, loadOlderError, sessionLoading, loadOlder, jumpToTurn,
  } = useSessionLoad({
    sessionId,
    setLocalMessages,
    setGenerating,
    isGeneratingRef,
    ownRunRef,
    streamRunRef,
    serverRunRef,
    aiPlaceholderIdRef,
    optimisticUserIdRef,
    pendingUserDisplaysRef,
    cancelStreamingCoalescer,
    metaRefreshedRef,
    scrollRef,
    jumpActiveRef,
    jumpCountRef,
  });
  loadOlderRef.current = loadOlder;
  // Jump rail: row window + full-history index + paging walk (`jump-rail.ts`).
  const { userTurns, jumpingTurn, jumpToUserTurn, rowWindow } = useTimelineJumpRail({
    sessionId,
    messages: localMessages,
    jumpToTurn,
    scroll,
  });

  // The composer's model/thinking mirrors and the mid-run stash (see the hook).
  const { pendingComposerModelRef, pendingThinkingLevelRef, composerModelRef, deferredComposerPickRef } =
    useComposerRefs(sessionId);

  // Access control is a GLOBAL, persisted user preference (unlike the
  // per-session model/thinking picks).
  const { accessMode, accessModeRef, setAccessMode: handleAccessModeChange } = useChatTimelineAccessMode(appSettings);

  // "Wait for session" on a NEW chat: the pick, and the ref the send handler
  // reads (see `choice.ts` for why both).
  const waitingDependency = useWaitingDependencyChoice(sessionId);

  const persistMessages = useCallback((messagesToSave: any[]) => {
    if (!sessionId) return;
    fetch(`/api/chat/${sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: messagesToSave }),
    }).catch(err => console.error('Error persisting messages via API:', err));
  }, [sessionId]);

  const {
    messageQueue,
    enqueueMessage,
    removeMessage,
    reorderMessages,
  } = useChatTimelineQueue(sessionId);
  const {
    pending: extensionDialogs,
    enqueue: enqueueExtensionDialog,
    resolve: resolveExtensionDialog,
    withdraw: withdrawExtensionDialog,
  } = useExtensionDialogQueue(sessionId);

  const ompAgent = useOmpAgent(isOmpSession ? sessionId : null, createOmpAgentCallbacks({
    setGenerating,
    setGeneratingVerb,
    activityRef,
    scrollToBottom,
    adoptedSessionIdRef,
    sessionIdRef,
    metaRefreshedRef,
    refreshSessionMeta,
    setLocalMessages,
    aiPlaceholderIdRef,
    optimisticUserIdRef,
    pendingUserDisplaysRef,
    persistMessages,
    abortControllerRef,
    appSettings,
    enqueueExtensionDialog,
    withdrawExtensionDialog,
    reloadMessages,
    needsReloadRef,
  }), activityRef, localMessagesRef);
  const spawn = useSpawnTarget(sessionId);

  const { steerOmpAgent, executeSend } = useChatTimelineSend({
    folders,
    selectedFolderId,
    sessionId,
    isOmpSession,
    appSettings,
    ompAgent,
    setLocalMessages,
    persistMessages,
    setGenerating,
    setGeneratingVerb,
    scrollToBottom,
    jumpToBottom,
    aiPlaceholderIdRef,
    adoptedSessionIdRef,
    optimisticUserIdRef,
    pendingUserDisplaysRef,
    seedSession,
    pendingComposerModelRef,
    pendingThinkingLevelRef,
    deferredComposerPickRef,
    accessModeRef,
    spawnSelectionRef: modes.spawnSelectionRef,
    spawnWorktreeRef: spawn.worktreePathRef,
    abortControllerRef,
    setInputValue,
    reportActionError,
    setSearchParams,
  });

  // Queue auto-delivery moved server-side: the wrapper's terminal `agent_end`
  // schedules the next queued prompt with a transactional head claim, so no
  // reload/tab race can double-send. `stopHoldRef` serves only the mock path.

  const { handleSend, handleEditQueueItem, handleSendNowQueueItem, handleUndo, handleRetry,
    submitNewChat, stopGenerating, handleThinkingLevelChange, handleModelChange } = useChatTimelineActions({
    inputValue,
    setInputValue,
    setInputAttachments,
    isGenerating,
    chatRunning: timelineRunning,
    isOmpSession,
    sessionId,
    folders,
    selectedFolderId,
    appSettings,
    messageQueue,
    enqueueMessage,
    removeMessage,
    executeSend,
    steerOmpAgent,
    ompAgent,
    abortControllerRef,
    setGenerating,
    stopHoldRef,
    persistMessages,
    setLocalMessages,
    localMessagesRef,
    pendingComposerModelRef,
    pendingThinkingLevelRef,
    composerModelRef,
    deferredComposerPickRef,
    accessModeRef,
    waitingDependencyRef: waitingDependency.ref,
    clearWaitingDependency: waitingDependency.clear,
    streamStatusMap,
    spawnSelectionRef: modes.spawnSelectionRef,
    setSearchParams,
    reportActionError,
  });

  return {
    sessionId,
    folderId,
    isOmpSession,
    selectedFolderId,
    setSelectedFolderId: selectContextFolder,
    sessionData,
    localMessages,
    isGenerating,
    timelineRunning,
    hasMore,
    loadingOlder,
    loadOlderError,
    sessionLoading,
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
    scrollToBottom,
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
    spawnTarget: spawn.target,
    setSpawnTarget: spawn.setTarget,
    extensionDialogs,
    resolveExtensionDialog,
    respondToExtensionUi: ompAgent.respondToExtensionUi,
  };
}
