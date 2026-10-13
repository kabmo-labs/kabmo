/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Message-send core for the chamber chat: reads text/image attachments, builds
 * the optimistic user + AI placeholder bubbles, then routes the send through
 * the live omp agent bridge (existing/new session) or the mock SSE stream.
 * Extracted from useChatTimeline so that hook stays under the size ceiling.
 */

import { useCallback } from 'preact/hooks';
import type { Dispatch, SetStateAction } from 'preact/compat';
import type { AgentImage, Attachment, ChatMessageData, OmpAgentHandle, PromptDispatchResult, QueuedMessageModel } from '@/shared/types';
import type { ApprovalMode } from '@/shared/lib/omp/config/access-mode';
import { streamChatResponse } from '@/client/hooks/chat/stream';
import type { SessionSeed } from '@/client/hooks/chat/timeline/session-load';
import { buildPromptText } from '@/client/hooks/chat/timeline/prompt-text';
import { flushDeferredPick, type DeferredModelStore } from '@/client/hooks/chat/timeline/deferred-model';
import {
  attachmentImage,
  attachmentName,
  attachmentSize,
  attachmentType,
  readTextAttachments,
} from '@/shared/lib/chat/attachments';
import { createMockStreamCallbacks } from '@/shared/lib/chat/timeline/stream-callbacks';
import { blockTuiOnlySend } from '@/client/hooks/chat/timeline/tui-only-guard';
import { PHASE_VERBS } from '@/shared/lib/chat/timeline/tool-phrases';
import { formatClock } from '@/shared/lib/format/time';

export interface ChatTimelineSendDeps {
  folders: any[];
  selectedFolderId: number | null;
  sessionId: string | null;
  isOmpSession: boolean;
  appSettings: Record<string, any>;
  ompAgent: OmpAgentHandle;
  setLocalMessages: Dispatch<SetStateAction<ChatMessageData[]>>;
  persistMessages: (messages: any[]) => void;
  setGenerating: (v: boolean, owned?: boolean) => void;
  setGeneratingVerb: (v: string) => void;
  /** Follow-gated scroll for stream chunks. */
  scrollToBottom: (behavior?: ScrollBehavior) => void;
  /** Explicit user-action scroll: re-engages follow mode (send/steer). */
  jumpToBottom: (behavior?: ScrollBehavior) => void;
  aiPlaceholderIdRef: { current: string | null };
  adoptedSessionIdRef: { current: string | null };
  optimisticUserIdRef: { current: string | null };
  pendingUserDisplaysRef: { current: { sent: string; display: string }[] };
  /** Adopt the spawned session's identity (model + the thinking level the first
   *  prompt runs with) so the composer replacing the pending view shows it. */
  seedSession: (seed: SessionSeed) => void;
  /** Model/thinking picked in the composer before the session existed —
   *  applied to the spawn command so the first prompt runs with them. */
  pendingComposerModelRef: { current: { provider: string; modelId: string } | null };
  pendingThinkingLevelRef: { current: string | null };
  /** Global access-control mode (persisted user preference), read at send time
   *  so the spawn-capable requests carry the latest value. */
  accessModeRef: { current: ApprovalMode };
  /** Plan/goal picks made on a pending `new-…` chat, applied to the spawn that
   *  replaces it. Read here rather than from `modes` because the spawn happens
   *  outside the render that produced the pick, and it is the FIRST moment a
   *  child exists to carry the selection. */
  spawnSelectionRef: { current: { plan: boolean; goal: boolean } | null };
  /** Picks the composer made while a turn was streaming. Pushed onto the
   *  session here, immediately before the prompt they were meant for. */
  deferredComposerPickRef: DeferredModelStore;
  abortControllerRef: { current: AbortController | null };
  setInputValue: (v: string) => void;
  setSearchParams: (fn: (prev: URLSearchParams) => URLSearchParams, opts?: { replace?: boolean }) => void;
}

export interface ChatTimelineSendResult {
  /** Steer the running turn; resolves with the outcome so a refusal can be
   *  reported (the composer is cleared before the request goes out). */
  steerOmpAgent: (text: string, attachments: Attachment[]) => Promise<PromptDispatchResult>;
  /** `model` re-applies a queued item's snapshot before the prompt runs
   *  (set_model / set_thinking_level RPC + prompt access mode). `busy: true`
   *  means omp REFUSED the prompt mid-turn — the caller queues it instead. */
  executeSend: (
    text: string,
    attachments: Attachment[],
    options?: { model?: QueuedMessageModel | null },
  ) => Promise<PromptDispatchResult>;
}

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
    deferredComposerPickRef,
    accessModeRef,
    spawnSelectionRef,
    abortControllerRef,
    setInputValue,
    setSearchParams,
  } = deps;

  // Reads text-file attachments and builds the prompt + image payload for an
  // omp delivery (mirror of executeSend's assembly block).
  const prepareDeliverable = useCallback(async (
    text: string,
    attachments: Attachment[],
  ): Promise<{ promptText: string; images?: AgentImage[] }> => {
    const textFiles = await readTextAttachments(attachments);
    const promptText = await buildPromptText(text, textFiles);
    pendingUserDisplaysRef.current = [...pendingUserDisplaysRef.current.slice(-7), { sent: promptText, display: text }];
    const images = attachments
      .map(attachmentImage)
      .filter((image): image is AgentImage => image !== null);
    return { promptText, images: images.length ? images : undefined };
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
    const newUserMsg: ChatMessageData = {
      id: userMsgId,
      role: 'user',
      date: `Today, ${time}`,
      // Precise epoch anchor: the footer run-duration measures from here until
      // the last AI message. The display `date` label is minute-granular, so a
      // string fallback would inflate the measured span by up to 59s.
      startedAt: now,
      content: text,
      attachments: attachments.map(a => ({
        name: attachmentName(a),
        // The blob URL only lives as long as this page, so the data URL wins
        // where it exists — a persisted turn re-renders its images from it.
        preview: a.dataBase64 ? `data:${attachmentType(a)};base64,${a.dataBase64}` : a.preview,
        type: attachmentType(a),
        size: attachmentSize(a),
        content: textContentById.get(a.id),
      }))
    };

    const initialAiMsg: ChatMessageData = {
      id: aiPlaceholderId,
      role: 'ai',
      date: `Today, ${time}`,
      startedAt: now,
      content: '',
    };

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
      const images = attachments
        .map(attachmentImage)
        .filter((image): image is AgentImage => image !== null);
      // Inline text-file contents into the prompt: the model sees the full file
      // content as fenced blocks, not just the filename.
      const promptText = await buildPromptText(text, textFiles);
      const result = await ompAgent.sendPrompt(promptText, images.length ? images : undefined, { accessMode: effectiveAccessMode });
      if (!result.ok) {
        // Roll back the optimistic bubbles on a failed send.
        setLocalMessages(prev => prev.filter(m => m.id !== userMsgId && m.id !== aiPlaceholderId));
        aiPlaceholderIdRef.current = null;
        optimisticUserIdRef.current = null;
        setGenerating(false);
      }
      return result;
    }

    // No active session (fresh "New Session"): in real mode spawn a brand-new
    // omp session and adopt its id; fall back to the mock/simulated path only
    // when the spawn fails (e.g. MOCK=true or no workspace context).
    if (!isOmpSession) {
      const currentFolder = folders.find(f => String(f.id) === String(selectedFolderId));
      const cwd = currentFolder?.project_path || currentFolder?.name;
      if (cwd) {
        const images = attachments
          .map(attachmentImage)
          .filter((image): image is AgentImage => image !== null);
        const promptText = await buildPromptText(text, textFiles);
        optimisticUserIdRef.current = userMsgId;
        const composerModel = pendingComposerModelRef.current;
        const composerThinking = pendingThinkingLevelRef.current;
        // The mode picks made on the pending view ride the spawn. Read once,
        // here, and cleared below on success: a selection that outlived its
        // spawn would re-apply to the NEXT new session the user opens.
        const spawnModes = spawnSelectionRef.current;
        const spawned = await ompAgent.sendNewPrompt(
          promptText,
          cwd,
          images.length ? images : undefined,
          { model: composerModel, thinkingLevel: composerThinking, accessMode: accessModeRef.current, modes: spawnModes },
        );
        if (spawned) {
          spawnSelectionRef.current = null;
          adoptedSessionIdRef.current = spawned.sessionId;
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

    // Mock / chamber-created session: existing simulated SSE path.
    // Cancel any previous stream
    optimisticUserIdRef.current = null;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const currentFolder = folders.find(f => String(f.id) === String(selectedFolderId));
    const workspaceName = currentFolder?.name || 'Workspace';

    await streamChatResponse(
      {
        sessionId: sessionId || `session-${Date.now()}`,
        prompt: text,
        workspaceName,
        attachments,
        signal: abortController.signal,
      },
      createMockStreamCallbacks({
        aiPlaceholderId,
        setLocalMessages,
        persistMessages,
        setGenerating,
        setGeneratingVerb,
        abortControllerRef,
        appSettings,
        scrollToBottom,
      })
    );
    return { ok: true, busy: false };
  }, [appSettings, folders, isOmpSession, ompAgent, selectedFolderId, sessionId, scrollToBottom, jumpToBottom, persistMessages, seedSession, pendingComposerModelRef, pendingThinkingLevelRef, deferredComposerPickRef, accessModeRef, setLocalMessages]);
  return { steerOmpAgent, executeSend };
}
