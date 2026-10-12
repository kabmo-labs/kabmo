import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { useTimelineScope } from '@/client/hooks/chat/timeline/scope';
import type { Attachment, ChatMessageData } from '@/shared/types';
import { useOmpAgent } from '@/client/hooks/chat/omp';
import { useChatTimelineQueue } from '@/client/hooks/chat/timeline/queue';
import { useExtensionDialogQueue } from '@/client/hooks/chat/timeline/extension-dialog';
import { useChatTimelineScroll } from '@/client/hooks/chat/timeline/scroll';
import { useTimelineAutoScroll } from '@/client/hooks/chat/timeline/auto-scroll';
import { useChatTimelineActions } from '@/client/hooks/chat/timeline/actions';
import { useChatTimelineSend } from '@/client/hooks/chat/timeline/send';
import type { ComposerModelPick } from '@/client/hooks/chat/timeline/deferred-model';
import { useSessionLoad } from '@/client/hooks/chat/timeline/session-load';
import { useUserTurns } from '@/client/hooks/chat/timeline/user-turns';
import { useBrowserPageContextInsert } from '@/client/hooks/chat/timeline/browser-context';
import { createOmpAgentCallbacks } from '@/shared/lib/chat/timeline/omp-callbacks';
import { cancelStreamingCoalescer } from '@/shared/lib/chat/timeline/stream-coalescer';
import { useChatTimelineAccessMode } from '@/client/hooks/chat/timeline/access-mode';
import { useComposerModes } from '@/client/hooks/chat/timeline/composer-modes';
import { useSessionState } from '@/client/hooks/workspace/session-state';
import { isSessionStreaming } from '@/client/hooks/chat/omp/session-statuses';

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

  const { scrollRef, contentRef, showScrollBottom, isScrolling, handleScroll, scrollToBottom, jumpToBottom, jumpActiveRef, jumpCountRef } = useChatTimelineScroll({
    onScrollTop: () => loadOlderRef.current(),
  });

  const [inputValue, setInputValue] = useSessionState<string>('chat.draft', '');
  useBrowserPageContextInsert(setInputValue);
  const [inputAttachments, setInputAttachments] = useSessionState<Attachment[]>('chat.draftAttachments', []);
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

  const [isGenerating, setIsGenerating] = useState(false);
  const isGeneratingRef = useRef(false);
  // True only for a run THIS PAGE dispatched: the mount probe that resumes a
  // live run's generating UI sets `isGenerating` too, so reading that as
  // ownership discarded the transcript of every session opened mid-stream.
  const ownRunRef = useRef(false);
  const localMessagesRef = useRef<ChatMessageData[]>([]);
  localMessagesRef.current = localMessages;
  const [generatingVerb, setGeneratingVerb] = useState('');
  const abortControllerRef = useRef<AbortController | null>(null);
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  // Stable identity is load-bearing: this is a dependency of the session-load
  // effect, which re-fetches history and replaces the timeline. A fresh
  // function per render made that effect re-run every render, and its
  // setLocalMessages(fetched) then re-rendered again — an unbounded fetch loop.
  //
  // `owned` marks a run THIS PAGE dispatched, which lets a committed history
  // fetch stand down while it streams. Only the SEND path passes it: every
  // other `setGenerating(true)` (a mount probe resuming a live run, an adopted
  // stream) must leave ownership alone, or a session opened mid-run loses its
  // whole transcript. Settling releases it.
  const setGenerating = useCallback((v: boolean, owned = false) => {
    isGeneratingRef.current = v;
    if (!v) ownRunRef.current = false;
    else if (owned) ownRunRef.current = true;
    setIsGenerating(v);
  }, []);
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

  // omp sessions are string UUIDs; chamber-created (mock/numeric) sessions are
  // integers, and a pending client-side "new-…" has no omp session yet — so
  // only a UUID routes through the live agent bridge.
  const isOmpSession = Boolean(sessionId) && !String(sessionId).startsWith('new-') && Number.isNaN(Number(sessionId));

  // One "a run is in flight" state for the whole chat: this client's own
  // dispatch window OR the server's `stream` row (`sidebar:status`), the exact
  // status the sidebar's spinner is drawn from. Every consumer that describes
  // the RUN (the docked indicator, the streaming row's marker, the withheld run
  // footer, queue-vs-send, Stop) reads this one flag. The removed
  // `stream-pending` mark was a third source and is why a finished run kept
  // spinning: it forced `stream` into `folders`, and a mark armed under one
  // session id and released under another was never released at all.
  const timelineRunning = isGenerating || isSessionStreaming(streamStatusMap, sessionId);

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

  // Jump rail: the full-history turn index (the mounted window is only a page
  // of a long session) plus the paging walk that reaches a turn outside it.
  const { turns: userTurns, jumping: jumpingTurn, jumpToTurn: jumpToUserTurn } = useUserTurns({
    sessionId,
    messages: localMessages,
    jumpToTurn,
  });

  // Composer picks made BEFORE the omp session exists (pending "new-…" view):
  // there is no live session to receive the RPC yet, so the selection is held
  // here and applied to the spawn command on first send.
  const pendingComposerModelRef = useRef<{ provider: string; modelId: string } | null>(null);
  const pendingThinkingLevelRef = useRef<string | null>(null);
  // Live mirror of the composer's model/thinking pick: the enqueue path
  // snapshots it onto queued items so auto-delivery replays those settings.
  const composerModelRef = useRef<{ provider: string; modelId: string; thinkingLevel: string } | null>(null);
  // Picks made WHILE a turn streams: held here so they cannot re-target the
  // answer in flight (omp applies set_model to the running turn), and pushed
  // onto the session right before the next prompt.
  const deferredComposerPickRef = useRef<ComposerModelPick | null>(null);
  // A stashed pick belongs to ONE session's next prompt: carrying it across a
  // switch would silently re-target the session the user just opened.
  useEffect(() => {
    deferredComposerPickRef.current = null;
  }, [sessionId]);

  // Access control is a GLOBAL, persisted user preference (unlike the
  // per-session model/thinking picks).
  const { accessMode, accessModeRef, setAccessMode: handleAccessModeChange } = useChatTimelineAccessMode(appSettings);

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
  }));
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
    isScrolling,
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
    extensionDialogs,
    resolveExtensionDialog,
    respondToExtensionUi: ompAgent.respondToExtensionUi,
  };
}
