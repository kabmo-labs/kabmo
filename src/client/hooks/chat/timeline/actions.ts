/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Composer/action handlers for Kabmo chat (send, send-now, edit/delete
 * queued items, undo, retry, new-chat, stop, model/thinking changes, close
 * dialog). Extracted from useChatTimeline so that hook stays under the repo's
 * per-file size ceiling. Everything these handlers need arrives via the deps
 * record — captured semantics are unchanged.
 */

import { useCallback, useMemo } from 'preact/hooks';
import type { Dispatch, SetStateAction } from 'preact/compat';
import type { Attachment, ChatMessageData, OmpAgentHandle, PromptDispatchResult, QueuedMessageModel, WorkspaceFolderData } from '@/shared/types';
import type { QueuedMessage } from '@/client/components/workspace/chat-timeline/QueueList';
import type { ApprovalMode } from '@/shared/lib/omp/config/access-mode';
import type { SetSearchParams } from '@/client/lib/router/search-params';
import { applyComposerPick, consumeComposerPick, stashComposerPick, type DeferredModelStore } from '@/client/hooks/chat/timeline/deferred-model';
import { useNewChatSubmit } from '@/client/hooks/chat/timeline/new-chat';
import { blockTuiOnlySend } from '@/client/hooks/chat/timeline/tui-only-guard';
import { dispatchLocalCommand } from '@/client/hooks/chat/timeline/local-commands';
import { createQueueActions } from '@/client/hooks/chat/timeline/queue-actions';
import { reportSteerOutcome } from '@/shared/lib/chat/timeline/steer-report';
import { createRewindActions } from '@/client/hooks/chat/timeline/rewind-actions';
import { enqueuePreparedFollowUp } from '@/client/hooks/chat/timeline/enqueue-follow-up';
import { readKabmoSetting } from '@/shared/lib/settings/client';
import { holdFromComposer } from '@/client/hooks/chat/waiting/hold';
import type { WaitingCandidate } from '@/client/components/workspace/chat-timeline/chat-input/WaitingDependencyPicker';

export interface ChatTimelineActionsDeps {
  inputValue: string;
  setInputValue: (v: string) => void;
  setInputAttachments: Dispatch<SetStateAction<Attachment[]>>;
  isGenerating: boolean;
  /** The CHAT-level "a run is in flight" flag (`timelineRunning`): the
   *  server-tracked `stream` status OR this client's own run. The queue-vs-send
   *  decision reads this, never `isGenerating` alone — a run this page did not
   *  start (a second tab, a scheduled task, a reload that never re-attached)
   *  still refuses a plain prompt mid-turn, and omp drops it. */
  chatRunning: boolean;
  isOmpSession: boolean;
  /** Active session id (null on pending "new-…"); the omp undo path posts the
   *  rewind against it. */
  sessionId: string | null;
  /** Workspace folders, for the New Chat send's spawn context: the pending
   *  session it opens carries the folder the chat was started from. */
  folders: WorkspaceFolderData[];
  /** Composer's explicitly picked folder, the fallback when the current session
   *  is not listed under any folder yet. */
  selectedFolderId: number | null;
  appSettings: Record<string, any>;
  messageQueue: QueuedMessage[];
  /** Server-backed per-item queue ops (append/remove/reorder). */
  enqueueMessage: (item: Omit<QueuedMessage, 'id'>) => void;
  removeMessage: (id: string) => void;
  executeSend: (text: string, attachments: Attachment[], options?: { model?: QueuedMessageModel | null }) => Promise<PromptDispatchResult>;
  steerOmpAgent: (text: string, attachments: Attachment[]) => Promise<PromptDispatchResult>;
  ompAgent: OmpAgentHandle;
  abortControllerRef: { current: AbortController | null };
  setGenerating: (v: boolean) => void;
  /** Armed by Stop; the queue auto-process holds off while it is set. */
  stopHoldRef: { current: boolean };
  persistMessages: (messages: any[]) => void;
  setLocalMessages: Dispatch<SetStateAction<ChatMessageData[]>>;
  /** Live mirror of the timeline: lets Undo/Retry read the current list and
   *  compute the truncated one OUTSIDE a state updater, so the persist call
   *  that follows cannot run twice. */
  localMessagesRef: { current: ChatMessageData[] };
  /** Composer model picked before the omp session exists (pending "new-…"
   *  view); held here until the spawn command carries it. */
  pendingComposerModelRef: { current: { provider: string; modelId: string } | null };
  /** Same as pendingComposerModelRef, for the thinking level. */
  pendingThinkingLevelRef: { current: string | null };
  /** Live composer model/thinking mirror, snapshotted onto queued items so
   *  auto-delivery replays the exact settings. */
  composerModelRef: { current: { provider: string; modelId: string; thinkingLevel: string } | null };
  /** Picks made while a turn streams: held back so they cannot re-target the
   *  in-flight answer, then pushed onto the session before the next prompt. */
  deferredComposerPickRef: DeferredModelStore;
  /** Global access-control mode, snapshotted onto queued items. */
  accessModeRef: { current: ApprovalMode };
  /**
   * The composer's "wait for session" pick, mirrored in a ref: the send handler
   * is created once per deps record, and reading the pick from render state
   * would send with whatever it was when that closure was built.
   */
  waitingDependencyRef?: { current: WaitingCandidate | null };
  /** Clear the pick once the prompt is held (the wait now owns it). */
  clearWaitingDependency?: () => void;
  /** Server-tracked `stream` rows: re-checked at send, so a dependency that
   *  finished while the draft was being written sends normally. */
  streamStatusMap?: Record<string, 'stream' | 'finish' | 'abort'>;
  /** Plan/goal flags the held spawn must carry (read when the wait is created,
   *  because the dispatch happens in another process later). */
  spawnSelectionRef?: { current: { plan: boolean; goal: boolean } | null };
  setSearchParams: SetSearchParams;
  /**
   * Surface a footer action that failed (rewind refused, send rejected). Undo
   * and Retry change the agent's context, so a silent no-op leaves the user
   * believing the timeline moved when it did not.
   */
  reportActionError: (message: string) => void;
}

export interface ChatTimelineActionsResult {
  handleSend: (attachments: Attachment[], options?: { steering?: boolean }) => Promise<void>;
  handleEditQueueItem: (item: QueuedMessage) => void;
  handleSendNowQueueItem: (item: QueuedMessage) => Promise<void>;
  handleUndo: (msgId: string, content?: string) => Promise<boolean>;
  handleRetry: (msgId: string) => void;
  submitNewChat: (text: string, attachments: Attachment[]) => void;
  /** Stop the active run; returns the number of queue items held back. */
  stopGenerating: () => number;
  handleThinkingLevelChange: (level: string) => void;
  handleModelChange: (provider: string, modelId: string) => void;
}

export function useChatTimelineActions(deps: ChatTimelineActionsDeps): ChatTimelineActionsResult {
  const {
    inputValue,
    setInputValue,
    isGenerating,
    chatRunning,
    isOmpSession,
    sessionId,
    folders,
    selectedFolderId,
    appSettings,
    messageQueue,
    enqueueMessage,
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
  } = deps;

  // The queue's two row actions take the same slice of this deps record, so
  // they are built once per render from it rather than re-listing every field.
  const queueActions = useMemo(() => createQueueActions(deps), [deps]);

  const enqueueFollowUp = useCallback(
    (text: string, attachments: Attachment[]) => enqueuePreparedFollowUp(
      { composerModelRef, accessModeRef, enqueueMessage },
      text,
      attachments,
    ),
    [composerModelRef, accessModeRef, enqueueMessage],
  );

  const handleSend = useCallback(async (attachments: Attachment[], options?: { steering?: boolean }) => {
    const textToSend = inputValue.trim();
    if (!textToSend && attachments.length === 0) return;

    // An explicit send disarms the Stop hold: the queue auto-process may
    // resume delivering after this run ends.
    stopHoldRef.current = false;

    // Commands Kabmo answers ITSELF, before anything can reach the model.
    if (dispatchLocalCommand(textToSend, attachments)) {
      setInputValue('');
      return;
    }

    // A command omp only implements in its TUI (`/plan`, `/clear`, `/login`, …)
    // would reach the model as literal text over RPC and burn a whole turn on
    // an improvisation. Answer it here, before it is queued or steered, and
    // keep the draft so the user can edit or retype it.
    if (blockTuiOnlySend(textToSend, setLocalMessages)) return;

    // A NEW chat whose prompt is held for another session: nothing is sent now,
    // and the pending row stays on screen saying what it waits for. Checked
    // before the queue-vs-send split — a pending chat has no run to queue behind.
    if (await holdFromComposer(deps, textToSend, attachments, isGenerating || chatRunning)) return;

    // "A run is in flight" is the CHAT-level flag, not this client's own:
    // `isGenerating` only knows the run THIS page started, so a second tab, a
    // scheduled task, the goal driver's continuation or a page that never
    // re-attached would look idle here. A plain send into that run is refused
    // by omp mid-turn and the prompt is lost — the reason this must read the
    // same signal the sidebar spinner and the Stop button do.
    if (isGenerating || chatRunning) {
      if (options?.steering) {
        // Explicit steering while a run is active.
        setInputValue('');
        if (isOmpSession) {
          reportSteerOutcome(await steerOmpAgent(textToSend, attachments), reportActionError);
        } else {
          if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
          }
          setGenerating(false);
          void executeSend(textToSend, attachments);
        }
        return;
      }
      // Non-steering submit while running: honor the Follow-up Dispatch
      // setting — queue the follow-up, or steer the running agent.
      // The blob is read through the shared resolver, so the pre-rename
      // `omp_chamber_settings` row is still honoured on an upgraded install.
      const behavior = readKabmoSetting<string>('followUpBehavior', appSettings) ?? 'queue';
      if (behavior === 'steering' && isOmpSession) {
        setInputValue('');
        reportSteerOutcome(await steerOmpAgent(textToSend, attachments), reportActionError);
        return;
      }
      // Both modes: the item is stored server-side (`queued_messages`) and the
      // panel is a view of it. Delivery happens when the run ends — the
      // wrapper's terminal `agent_end` claims the head and dispatches it.
      setInputValue('');
      enqueueFollowUp(textToSend, attachments);
      return;
    }

    setInputValue('');
    const result = await executeSend(textToSend, attachments);
    // The run we did not know about refused the prompt (omp answered
    // `agent_busy`): nothing was delivered, so queue it exactly as the running
    // branch would rather than losing the message. Every other failure may
    // already have been accepted, and is reported by the send path instead.
    if (result.busy) enqueueFollowUp(textToSend, attachments);
  }, [deps, inputValue, isGenerating, chatRunning, executeSend, enqueueMessage, enqueueFollowUp, isOmpSession, appSettings, steerOmpAgent, setInputValue, abortControllerRef, setGenerating, stopHoldRef, composerModelRef, accessModeRef, setLocalMessages]);

  const handleEditQueueItem = useCallback((item: QueuedMessage) => {
    queueActions.handleEditQueueItem(item);
  }, [queueActions]);

  const handleSendNowQueueItem = useCallback(async (item: QueuedMessage) => {
    await queueActions.handleSendNowQueueItem(item);
  }, [queueActions]);

  // Undo and Retry share the same three rules (rewind the JSONL first, retry
  // from the run's own user turn, report a refusal) — see `rewind-actions.ts`.
  const { handleUndo, handleRetry } = useMemo(
    () => createRewindActions({
      isGenerating,
      isOmpSession,
      sessionId,
      ompAgent,
      abortControllerRef,
      setGenerating,
      setInputValue,
      setLocalMessages,
      localMessagesRef,
      persistMessages,
      executeSend,
      reportActionError,
    }),
    [isGenerating, isOmpSession, sessionId, ompAgent, abortControllerRef, setGenerating, setInputValue, setLocalMessages, localMessagesRef, persistMessages, executeSend, reportActionError],
  );

  const submitNewChat = useNewChatSubmit({
    sessionId,
    folders,
    selectedFolderId,
    setSearchParams,
    setLocalMessages,
    executeSend,
  });

  /** Stop the active run. Returns how many queue items were held back so the
   *  caller can surface a "still queued" toast. Stop-all semantics: the queue
   *  auto-process holds off until the next explicit send. */
  const stopGenerating = useCallback((): number => {
    stopHoldRef.current = true;
    if (isOmpSession) {
      void ompAgent.abort();
    } else if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setGenerating(false);
    return messageQueue.length;
  }, [isOmpSession, ompAgent, abortControllerRef, setGenerating, messageQueue.length, stopHoldRef]);

  const handleThinkingLevelChange = useCallback((level: string) => {
    if (level === 'auto') return;
    if (!isOmpSession) {
      pendingThinkingLevelRef.current = level;
      return;
    }
    // A pick made mid-run is intent for the NEXT prompt: pushing it now would
    // re-target the turn already streaming (omp applies set_thinking_level to
    // the running turn's next LLM call).
    if (isGenerating) {
      stashComposerPick(deferredComposerPickRef, { thinkingLevel: level });
      return;
    }
    consumeComposerPick(deferredComposerPickRef, { thinkingLevel: level });
    void ompAgent.setThinkingLevel(level);
  }, [isGenerating, isOmpSession, ompAgent, pendingThinkingLevelRef, deferredComposerPickRef]);

  const handleModelChange = useCallback((provider: string, modelId: string) => {
    if (!isOmpSession) {
      pendingComposerModelRef.current = { provider, modelId };
      return;
    }
    // Same rule as the thinking pick: a mid-run model change is held back so
    // the answer being streamed finishes on the model it started with, and is
    // applied right before the next prompt this composer sends.
    if (isGenerating) {
      stashComposerPick(deferredComposerPickRef, { provider, modelId });
      return;
    }
    consumeComposerPick(deferredComposerPickRef, { provider, modelId });
    void applyComposerPick(ompAgent, { provider, modelId });
  }, [isGenerating, isOmpSession, ompAgent, pendingComposerModelRef, deferredComposerPickRef]);

  return {
    handleSend,
    handleEditQueueItem,
    handleSendNowQueueItem,
    handleUndo,
    handleRetry,
    submitNewChat,
    stopGenerating,
    handleThinkingLevelChange,
    handleModelChange,
  };
}
