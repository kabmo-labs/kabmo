/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Message-send core for Kabmo chat: reads text/image attachments, builds
 * the optimistic user + AI placeholder bubbles, then routes the send through
 * the live omp agent bridge (existing/new session) or the mock SSE stream.
 * Extracted from useChatTimeline so that hook stays under the size ceiling.
 */

import { useCallback } from 'preact/hooks';
import type { ChatTimelineSendDeps, ChatTimelineSendResult } from '@/client/hooks/chat/timeline/send-props';

export type { ChatTimelineSendDeps, ChatTimelineSendResult };
import type { AgentImage, Attachment, PromptDispatchResult, QueuedMessageModel } from '@/shared/types';
import { flushDeferredPick } from '@/client/hooks/chat/timeline/deferred-model';
import { buildOptimisticRows, collectImages, assemblePrompt, streamMockFallback } from '@/client/hooks/chat/timeline/send-helpers';
import { markPendingSessionSent } from '@/client/hooks/chat/omp/pending-sessions';
import { dispatchPendingChat } from '@/client/hooks/chat/timeline/pending-dispatch';
import { postModeCommand } from '@/client/hooks/chat/timeline/mode-post';
import type { ArmedGoal } from '@/shared/lib/omp/mode/actions';
import { blockTuiOnlySend } from '@/client/hooks/chat/timeline/tui-only-guard';
import { PHASE_VERBS } from '@/shared/lib/chat/timeline/tool-phrases';
import { formatClock } from '@/shared/lib/format/time';

export function useChatTimelineSend(deps: ChatTimelineSendDeps): ChatTimelineSendResult {
  const {
    folders,
    selectedFolderId,
    sessionId,
    isOmpSession,
    harness,
    appSettings,
    ompAgent,
    setLocalMessages,
    persistMessages,
    setGenerating,
    setGeneratingVerb,
    scrollToBottom,
    jumpToBottom,
    aiPlaceholderIdRef,
    optimisticUserIdRef,
    pendingUserDisplaysRef,
    seedSession,
    pendingComposerModelRef,
    pendingThinkingLevelRef,
    deferredComposerPickRef,
    accessModeRef,
    goalArmRef,
    disarmGoal,
    abortControllerRef,
    setInputValue,
    reportActionError,
  } = deps;

  // `@agent` mentions are omp's subagent syntax. An ACP harness has no such
  // agents, and the picker already hides them there.
  const includeAgents = !harness || harness === 'omp-rpc' || harness === 'omp-acp';

  /**
   * Start the armed goal before the prompt leaves. `guided` folds the operator's
   * words into the interview's opening turn (the caller must not send it again);
   * `create` writes the record and lets the prompt be its first turn. A refusal
   * is reported, and the prompt still goes out for `create`.
   */
  const startArmedGoal = useCallback(async (targetId: string, armed: ArmedGoal, promptText: string): Promise<boolean> => {
    const posted = armed.kind === 'guided'
      // `message` is the operator's prompt: the extension renders its kickoff
      // with this as the visible content of turn one.
      ? await postModeCommand(targetId, 'goal', 'guided', { message: promptText, rough: '' })
      : await postModeCommand(targetId, 'goal', 'create', {
        objective: armed.objective,
        ...(armed.tokenBudget === undefined ? {} : { tokenBudget: armed.tokenBudget }),
        ...(armed.maxTurns === undefined ? {} : { maxTurns: armed.maxTurns }),
        // The prompt that follows IS the goal's first turn. Without this the
        // child would open its own hidden turn and the operator's message would
        // arrive as a second turn — or be refused as `agent_busy`.
        startTurn: false,
      });
    if (!posted.ok) {
      reportActionError(`The goal was not started: ${posted.error ?? 'the child refused it'}`);
      return false;
    }
    disarmGoal();
    return armed.kind === 'guided';
  }, [disarmGoal, reportActionError]);

  // Reads text-file attachments and builds the prompt + image payload for an
  // omp delivery (mirror of executeSend's assembly block).
  const prepareDeliverable = useCallback(async (
    text: string,
    attachments: Attachment[],
  ): Promise<{ promptText: string; images?: AgentImage[] }> => {
    const assembled = await assemblePrompt(text, attachments, includeAgents);
    if (!assembled.ok) throw new Error(assembled.error);
    pendingUserDisplaysRef.current = [...pendingUserDisplaysRef.current.slice(-7), { sent: assembled.promptText, display: text }];
    return { promptText: assembled.promptText, images: collectImages(attachments) };
  }, [includeAgents, pendingUserDisplaysRef]);

  // Steer the running omp agent (interrupt-and-reply). Returns the outcome so
  // the caller can report a refusal: the composer is cleared before this runs.
  const steerOmpAgent = useCallback(async (text: string, attachments: Attachment[]): Promise<PromptDispatchResult> => {
    // A steer IS a new prompt: a pick made during the interrupted turn belongs
    // to it, so it is pushed before the interrupt-and-reply starts the turn.
    await flushDeferredPick(ompAgent, deferredComposerPickRef);
    let deliverable: { promptText: string; images?: AgentImage[] };
    try {
      deliverable = await prepareDeliverable(text, attachments);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reportActionError(message);
      setInputValue(text);
      return { ok: false, busy: false, error: message };
    }
    const result = await ompAgent.steerOmpRun(deliverable.promptText, deliverable.images);
    if (!result.ok) setInputValue(text);
    return result;
  }, [ompAgent, prepareDeliverable, setInputValue, deferredComposerPickRef, reportActionError]);

  const executeSend = useCallback(async (
    text: string,
    attachments: Attachment[],
    options?: { model?: QueuedMessageModel | null; harness?: string | null },
  ) => {
    // Last gate before a prompt leaves the client. `handleSend` already refuses
    // these, but `executeSend` is also reached by a retry of a stored turn, a
    // queued item's "Send now", and `submitNewChat` — all of which can carry a
    // command that was typed before the guard existed, or that arrived from the
    // queue. Nothing has been rendered yet, so no rollback is needed.
    if (blockTuiOnlySend(text, setLocalMessages, harness)) return { ok: false, busy: false, error: 'TUI-only command' };
    // A queued delivery replays the snapshot the item was queued with; a plain
    // send keeps the session's live picks. 'auto' thinking leaves omp alone.
    const modelOverride = options?.model ?? null;
    const effectiveAccessMode = modelOverride?.accessMode ?? accessModeRef.current;
    const time = formatClock();
    const userMsgId = `msg-${Date.now()}-user`;
    const aiPlaceholderId = `msg-${Date.now() + 1}-ai`;

    // A delegation refusal (two harnesses in one paragraph, an unknown
    // harness, an empty task) must land before any optimistic bubble exists.
    const assembled = await assemblePrompt(text, attachments, includeAgents);
    if (!assembled.ok) {
      reportActionError(assembled.error);
      return { ok: false, busy: false, error: assembled.error };
    }
    const { textFiles, promptText } = assembled;
    const textContentById = new Map(textFiles.map((file) => [file.id, file.content]));
    const now = Date.now();
    const { newUserMsg, initialAiMsg } = buildOptimisticRows({
      text,
      attachments,
      textContentById,
      time,
      now,
      userMsgId,
      aiPlaceholderId,
    });

    setLocalMessages(prev => {
      const next = [...prev, newUserMsg, initialAiMsg];
      // Safe inside the updater: this persist is a full-array write to the same
      // row, so re-applying it is a no-op. A side effect that must happen
      // EXACTLY once (a send, a rewind) never belongs here — see
      // `actions.handleRetry`.
      persistMessages(next.filter(m => m.id !== aiPlaceholderId));
      return next;
    });
    // Arm the placeholder ref WITH its row, never after the spawn await. A
    // brand-new session's child streams its first frames before
    // `sendNewPrompt` resolves, and a frame that finds no placeholder APPENDS
    // its message beside the placeholder row instead of filling it; arming the
    // ref afterwards then made the next update map the placeholder onto that
    // same id, rendering the turn (and its ask card) TWICE — measured as two
    // cards for one ask, one "Running" and one "Done", on ~1 run in 30.
    aiPlaceholderIdRef.current = aiPlaceholderId;

    setGenerating(true, true);
    setGeneratingVerb(PHASE_VERBS.thinking);
    // An explicit send is user intent to watch the answer: re-engage follow
    // mode even if the user had scrolled away, then scroll to the tail.
    setTimeout(() => jumpToBottom('smooth'), 50);

    // Real mode: route through the omp agent RPC bridge + event stream.
    if (isOmpSession) {
      // This chat now has a prompt in flight, so its sidebar row must survive a
      // switch away: omp's transcript — which would draw the row for real — is
      // seconds behind. A no-op for a session the store does not know.
      if (sessionId) markPendingSessionSent(sessionId);
      optimisticUserIdRef.current = userMsgId;
      // A model/thinking pick made while the previous turn streamed was held
      // back so it could not re-target that answer. A queued delivery does NOT
      // own it: that item carries its own snapshot, so the pick stays pending
      // for the composer's own next prompt instead of being spent — and then
      // overwritten — by a delivery it was never meant for.
      if (!modelOverride) await flushDeferredPick(ompAgent, deferredComposerPickRef);
      // Replay the queued snapshot first so the prompt runs on the exact
      // model/thinking the item was queued with.
      if (modelOverride) {
        await ompAgent.setModel(modelOverride.provider, modelOverride.modelId);
        if (modelOverride.thinkingLevel !== 'auto') {
          await ompAgent.setThinkingLevel(modelOverride.thinkingLevel);
        }
      }
      const images = collectImages(attachments);
      // `promptText` was assembled once above, so no refusal can reach here.
      const armed = goalArmRef.current;
      const consumed = armed && sessionId ? await startArmedGoal(sessionId, armed, promptText) : false;
      if (consumed) return { ok: true, busy: false };
      const result = await ompAgent.sendPrompt(promptText, images, { accessMode: effectiveAccessMode });
      if (!result.ok) {
        // Roll back the optimistic bubbles on a failed send.
        setLocalMessages(prev => prev.filter(m => m.id !== userMsgId && m.id !== aiPlaceholderId));
        aiPlaceholderIdRef.current = null;
        optimisticUserIdRef.current = null;
        setGenerating(false);
        // And SAY so. The rollback alone left the operator's turn vanishing
        // with no explanation, which is the reported "gagal kirim prompt": the
        // server's reason (a dead child, a session another process owns) was
        // computed and then dropped on the floor.
        reportActionError(`Prompt not sent: ${result.error ?? 'the session refused it'}`);
      }
      return result;
    }

    // No active session (fresh "New Session"): a top-level chat or a pending
    // child spawns its real session and adopts its id. `null` means the
    // simulated path below owns it (no cwd, MOCK mode).
    const pending = !isOmpSession
      ? await dispatchPendingChat(deps, {
          text,
          attachments,
          promptText,
          userMsgId,
          aiPlaceholderId,
          newUserMsg,
          ...(options ? { options } : {}),
          startArmedGoal,
        })
      : null;
    if (pending) return pending;

    // Mock / Kabmo-created session: existing simulated SSE path.
    const currentFolder = folders.find(f => String(f.id) === String(selectedFolderId));
    return streamMockFallback({
      sessionId,
      text,
      attachments,
      workspaceName: currentFolder?.name || 'Workspace',
      aiPlaceholderId,
      abortControllerRef,
      optimisticUserIdRef,
      appSettings,
      setLocalMessages,
      persistMessages,
      setGenerating,
      setGeneratingVerb,
      scrollToBottom,
    });
  }, [appSettings, folders, isOmpSession, harness, ompAgent, selectedFolderId, sessionId, scrollToBottom, jumpToBottom, persistMessages, seedSession, pendingComposerModelRef, pendingThinkingLevelRef, deferredComposerPickRef, accessModeRef, setLocalMessages, reportActionError]);
  return { steerOmpAgent, executeSend };
}
