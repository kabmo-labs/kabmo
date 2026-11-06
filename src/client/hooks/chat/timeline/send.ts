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
import { buildPromptText } from '@/client/hooks/chat/timeline/prompt-text';
import { flushDeferredPick } from '@/client/hooks/chat/timeline/deferred-model';
import { readTextAttachments } from '@/shared/lib/chat/attachments';
import { buildOptimisticRows, collectImages, streamMockFallback } from '@/client/hooks/chat/timeline/send-helpers';
import { adoptPendingSession, markPendingSessionSent } from '@/client/hooks/chat/omp/pending-sessions';
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
    pendingHarnessRef,
    deferredComposerPickRef,
    accessModeRef,
    spawnSelectionRef,
    goalArmRef,
    disarmGoal,
    spawnWorktreeRef,
    abortControllerRef,
    setInputValue,
    reportActionError,
    setSearchParams,
  } = deps;

  /**
   * Start the armed goal in `sessionId`, from the operator's own prompt.
   *
   * Awaited BEFORE the prompt leaves, so the order is a fact. Resolves TRUE when
   * the goal consumed the prompt — the caller must then not send it again.
   *
   *  - `create` — the record is written with `startTurn: false`, and the prompt
   *    that follows is the goal's first turn. The prompt is still sent.
   *  - `guided` — there is no objective yet (the model writes it at the end of
   *    the interview), so the operator's message IS the interview's opening
   *    turn: the extension renders its kickoff prompt with their words folded
   *    in (`<rough-goal>`) and runs that as turn one. The raw message is
   *    therefore NOT sent separately — it is already inside that turn.
   *
   * A refusal is reported rather than swallowed, and the prompt still goes out
   * for `create`: the goal the operator set is missing, but their words are not
   * the goal's business. A refused `guided` cannot fall back the same way — the
   * interview kickoff is the extension's text — so it resolves false and the
   * caller sends the message as an ordinary prompt.
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
    const textFiles = await readTextAttachments(attachments);
    const promptText = await buildPromptText(text, textFiles);
    pendingUserDisplaysRef.current = [...pendingUserDisplaysRef.current.slice(-7), { sent: promptText, display: text }];
    return { promptText, images: collectImages(attachments) };
  }, []);

  // Steer the running omp agent (interrupt-and-reply). Returns the outcome so
  // the caller can report a refusal: the composer is cleared before this runs.
  const steerOmpAgent = useCallback(async (text: string, attachments: Attachment[]): Promise<PromptDispatchResult> => {
    // A steer IS a new prompt: a pick made during the interrupted turn belongs
    // to it, so it is pushed before the interrupt-and-reply starts the turn.
    await flushDeferredPick(ompAgent, deferredComposerPickRef);
    const { promptText, images } = await prepareDeliverable(text, attachments);
    const result = await ompAgent.steerOmpRun(promptText, images);
    if (!result.ok) setInputValue(text);
    return result;
  }, [ompAgent, prepareDeliverable, setInputValue, deferredComposerPickRef]);

  const executeSend = useCallback(async (
    text: string,
    attachments: Attachment[],
    options?: { model?: QueuedMessageModel | null },
  ) => {
    // Last gate before a prompt leaves the client. `handleSend` already refuses
    // these, but `executeSend` is also reached by a retry of a stored turn, a
    // queued item's "Send now", and `submitNewChat` — all of which can carry a
    // command that was typed before the guard existed, or that arrived from the
    // queue. Nothing has been rendered yet, so no rollback is needed.
    if (blockTuiOnlySend(text, setLocalMessages)) return { ok: false, busy: false, error: 'TUI-only command' };
    // A queued delivery replays the snapshot the item was queued with; a plain
    // send keeps the session's live picks. 'auto' thinking leaves omp alone.
    const modelOverride = options?.model ?? null;
    const effectiveAccessMode = modelOverride?.accessMode ?? accessModeRef.current;
    const time = formatClock();
    const userMsgId = `msg-${Date.now()}-user`;
    const aiPlaceholderId = `msg-${Date.now() + 1}-ai`;

    // Read text-file contents once: used for the editor (attachment.content)
    // and for inlining into the prompt. Reads a persisted `content` when the
    // attachment is a replay (queue delivery, retry) and has no live File.
    const textFiles = await readTextAttachments(attachments);
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
      // Inline text-file contents into the prompt: the model sees the full file
      // content as fenced blocks, not just the filename.
      const promptText = await buildPromptText(text, textFiles);
      // The armed goal is created HERE, at the fence of the prompt that will be
      // its first turn — never earlier (nothing to act on) and never after the
      // prompt (the goal would miss its opening turn). An armed INTERVIEW
      // consumes this prompt as its kickoff, so nothing is sent after it.
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

    // No active session (fresh "New Session"): in real mode spawn a brand-new
    // omp session and adopt its id; fall back to the mock/simulated path only
    // when the spawn fails (e.g. MOCK=true or no workspace context).
    if (!isOmpSession) {
      const currentFolder = folders.find(f => String(f.id) === String(selectedFolderId));
      // A worktree pick wins: the chat is BORN there, so no relocation is ever
      // needed and the child's cwd is right for its whole life.
      const cwd = spawnWorktreeRef.current || currentFolder?.project_path || currentFolder?.name;
      if (cwd) {
        const images = collectImages(attachments);
        const promptText = await buildPromptText(text, textFiles);
        optimisticUserIdRef.current = userMsgId;
        const composerModel = pendingComposerModelRef.current;
        const composerThinking = pendingThinkingLevelRef.current;
        // The mode picks made on the pending view ride the spawn. Read once,
        // here, and cleared below on success: a selection that outlived its
        // spawn would re-apply to the NEXT new session the user opens.
        const spawnModes = spawnSelectionRef.current;
        // An armed goal is recorded between the spawn and the prompt: the id
        // exists by then, and the prompt below is the goal's first turn. Not
        // after the prompt — a fast turn could finish before the record landed,
        // leaving a goal with no turn to act on.
        const armed = goalArmRef.current;
        const spawned = await ompAgent.sendNewPrompt(
          promptText,
          cwd,
          images,
          {
            model: composerModel,
            thinkingLevel: composerThinking,
            accessMode: accessModeRef.current,
            modes: spawnModes,
            // A harness picked on the pending view rides the spawn; cleared on
            // success below so it cannot leak onto the next new chat.
            ...(pendingHarnessRef.current ? { harness: pendingHarnessRef.current } : {}),
          },
          armed ? (id) => startArmedGoal(id, armed, promptText) : undefined,
        );
        if (spawned) {
          spawnSelectionRef.current = null;
          adoptedSessionIdRef.current = spawned.sessionId;
          // The sidebar's row moves with the id: `new-…` was the client's own
          // placeholder, and the spawn answers with omp's real one, which omp
          // has still not written a transcript for. Without this the row
          // vanished at exactly the moment the URL stopped naming the pending
          // id, which is the gap this store exists to close.
          adoptPendingSession(sessionId, spawned.sessionId, currentFolder?.id ?? null);
          // The placeholder ref is already armed (with its row) before the
          // spawn — see the note at the assignment; re-arming here would be
          // harmless but is redundant.
          // The spawn already applied this level to the session; seed it so the
          // composer taking over from the pending view reports the run's real
          // setting instead of a catalog default (the JSONL that carries it is
          // not locatable yet).
          seedSession({ model: spawned.model, thinkingLevel: composerThinking });
          pendingComposerModelRef.current = null;
          pendingThinkingLevelRef.current = null;
          pendingHarnessRef.current = null;
          fetch(`/api/chat/${encodeURIComponent(spawned.sessionId)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: [newUserMsg] }),
          }).catch(err => console.error('Error persisting spawned user turn:', err));
          setSearchParams(prev => {
            const next = new URLSearchParams(prev);
            next.set('sessionId', spawned.sessionId);
            return next;
          }, { replace: true });
          // The sidebar already re-read at prompt dispatch (sendNewPrompt
          // signals it), so the new session shows its live badge without
          // waiting for the JSONL to carry the user turn.
          return { ok: true, busy: false };
        }
      }
    }

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
  }, [appSettings, folders, isOmpSession, ompAgent, selectedFolderId, sessionId, scrollToBottom, jumpToBottom, persistMessages, seedSession, pendingComposerModelRef, pendingThinkingLevelRef, deferredComposerPickRef, accessModeRef, setLocalMessages]);
  return { steerOmpAgent, executeSend };
}
