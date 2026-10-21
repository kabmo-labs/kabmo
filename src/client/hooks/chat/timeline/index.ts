import { useCallback, useRef, useState } from 'preact/hooks';
import { useTimelineScope } from '@/client/hooks/chat/timeline/scope';
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
import { useUserTurns } from '@/client/hooks/chat/timeline/user-turns';
import { useRailJump } from '@/client/hooks/chat/timeline/rail-jump';
import { createOmpAgentCallbacks } from '@/shared/lib/chat/timeline/omp-callbacks';
import { cancelStreamingCoalescer } from '@/shared/lib/chat/timeline/stream-coalescer';
import { useChatTimelineAccessMode } from '@/client/hooks/chat/timeline/access-mode';
import { useComposerModes } from '@/client/hooks/chat/timeline/composer-modes';
import { useComposerDraft } from '@/client/hooks/chat/composer/use-draft';
import { isChatRunning } from '@/client/hooks/chat/omp/session-statuses';
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
  // access mode: they describe what this conversation is doing, and a global
  // toggle would drag every other open chat into the same mode. One hook
  // returns both halves, because a mode command can produce a proposal and
  // answering that proposal is itself a mode command.
  const { modes, planReview } = useComposerModes(sessionId);

  // Ref mirror of loadOlder so the scroll handler can call the latest one
  // without re-creating it (useSessionLoad is defined below the scroll hook).
  const loadOlderRef = useRef<() => void>(() => {});

  const { scrollRef, contentRef, showScrollBottom, readingBack, handleScroll, scrollToBottom, jumpToBottom, followRef, jumpActiveRef, jumpCountRef } = useChatTimelineScroll({
    onScrollTop: () => loadOlderRef.current(),
  });

  const { inputValue, setInputValue, inputAttachments, setInputAttachments } = useComposerDraft();
  const [localMessages, setLocalMessages] = useState<ChatMessageData[]>([]);

  // A pending "new-…" session renders the workspace picker, which owns its own
  // timeline and scroll handling.
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

  const aiPlaceholderIdRef = useRef<string | null>(null);

  const {
    sessionData,
    adoptedSessionIdRef, refreshSessionMeta, seedSession,
    hasMore,
    loadingOlder, loadOlderError, sessionLoading, loadOlder, jumpToTurn,
  } = useSessionLoad({
    sessionId,
    setLocalMessages,
    setGenerating,
    isGeneratingRef,
    ownRunRef,
    aiPlaceholderIdRef,
    optimisticUserIdRef,
    cancelStreamingCoalescer,
    metaRefreshedRef,
    scrollRef,
    jumpActiveRef,
    jumpCountRef,
  });
  loadOlderRef.current = loadOlder;

  // Jump rail: the full-history turn index plus the paging walk that reaches a
  // turn outside the mounted window. The walk is wrapped so follow mode stands
  // down until the jump lands (see rail-jump.ts).
  const { turns: userTurns, jumping: jumpingTurn, jumpToTurn: pagedJumpToTurn } = useUserTurns({
    sessionId,
    messages: localMessages,
    jumpToTurn,
  });
  const jumpToUserTurn = useRailJump(pagedJumpToTurn, { followRef, scrollRef });

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
  }), activityRef);
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
    abortControllerRef,
    setInputValue,
    setSearchParams,
  });

  // Queue auto-delivery moved server-side: the wrapper's terminal `agent_end`
  // schedules the next queued prompt (`lib/queue/delivery.server.ts`), with a
  // transactional head claim so no reload/tab race can double-send. The client
  // panel is a view; `stopHoldRef` remains only for the mock path below.

  const {
    handleSend,
    handleEditQueueItem,
    handleSendNowQueueItem,
    handleUndo,
    handleRetry,
    submitNewChat,
    stopGenerating,
    handleThinkingLevelChange,
    handleModelChange,
  } = useChatTimelineActions({
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
    scrollRef,
    contentRef,
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
    extensionDialogs,
    resolveExtensionDialog,
    respondToExtensionUi: ompAgent.respondToExtensionUi,
  };
}
