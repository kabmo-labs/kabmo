/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Builds the live-omp-agent callback object consumed by useChatTimeline's
 * useOmpAgent(...). Extracted so the timeline hook stays under the repo's
 * per-file size ceiling. Every closure here mutates the caller's state/refs,
 * so they are passed in as a single deps record and read as `deps.*` — the
 * captured semantics (including side effects inside setState updaters, e.g.
 * aiPlaceholderIdRef reset + persistMessages on message_end) are unchanged.
 */

import type { Dispatch, SetStateAction } from 'preact/compat';
import type { ChatMessageData, ExtensionUiDialogRequest, IncomingExtensionUiRequest, OmpAgentCallbacks } from '@/shared/types';
import { triggerChatCompletionSound } from '@/client/hooks/ui/notification-sound';
import { isNoticeRow } from '@/shared/lib/chat/notice-row';
import {
  bindStreamingCoalescer,
  disposeStreamingCoalescer,
  flushStreamingUpdates,
  queueStreamingUpdate,
} from '@/shared/lib/chat/timeline/stream-coalescer';
import { appendNoticeRow } from '@/shared/lib/chat/timeline/command-output';
import { retryNotice } from '@/shared/lib/chat/timeline/provider-retry';
import { handleAgentStart, handleResumeStream, handleTurnStart } from '@/shared/lib/chat/timeline/run-signals';
import { isAnswerableUiRequest } from '@/shared/lib/omp/dialog-methods';

export interface OmpAgentCallbacksDeps {
  setGenerating: (v: boolean) => void;
  setGeneratingVerb: (v: string) => void;
  /** Non-reactive mirror of the phrase the indicator is showing, shared with
   *  the fold's dedupe key. The resume path consults it: a reattach knows only
   *  that a run is live, not what the run is doing, so it must not overwrite a
   *  phrase a frame already named. */
  activityRef: { current: string };
  scrollToBottom: (behavior?: ScrollBehavior) => void;
  adoptedSessionIdRef: { current: string | null };
  sessionIdRef: { current: string | null };
  metaRefreshedRef: { current: string | null };
  refreshSessionMeta: (sid: string) => void;
  setLocalMessages: Dispatch<SetStateAction<ChatMessageData[]>>;
  aiPlaceholderIdRef: { current: string | null };
  optimisticUserIdRef: { current: string | null };
  pendingUserDisplaysRef: { current: { sent: string; display: string }[] };
  persistMessages: (messages: any[]) => void;
  abortControllerRef: { current: AbortController | null };
  appSettings: Record<string, any>;
  /** Queue one omp ask/approval dialog; a turn can raise several at once. */
  enqueueExtensionDialog: (request: ExtensionUiDialogRequest) => void;
  /** Drop a queued request omp withdrew (`method: 'cancel'`). */
  withdrawExtensionDialog: (targetId: string) => void;
}

export function createOmpAgentCallbacks(deps: OmpAgentCallbacksDeps): OmpAgentCallbacks {
  const {
    setGenerating,
    setGeneratingVerb,
    scrollToBottom,
    adoptedSessionIdRef,
    sessionIdRef,
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
  } = deps;

  bindStreamingCoalescer(setLocalMessages, () => scrollToBottom('smooth'));

  return {
    onAgentStart: () => handleAgentStart(deps),
    onTurnStart: () => handleTurnStart(deps),
    // Reload recovery: the omp process kept running server-side, so the event
    // stream is reattached and the generating UI must resume (the timeline
    // fetch already loaded the committed messages; live updates continue).
    onResumeStream: () => handleResumeStream(deps),
    // The stream names what the agent is doing right now (tool call or
    // assistant phase), so the indicator stops guessing.
    onActivity: (verb) => {
      setGeneratingVerb(verb);
    },
    // omp-web mirrors this exactly: streaming updates live in a SEPARATE
    // slot that is replaced wholesale on every update (never merged into the
    // committed list), and only flushed to history on message_end. omp's
    // message frames are timestamp-identified, not id-identified.
    onMessageUpdate: (msg) => {
      // The optimistic mark is released when the turn it stands for has been
      // reconciled (the `msg.role === 'user'` branch below), NOT here.
      //
      // Clearing it on any non-user frame was wrong, and it is the whole
      // duplicate-turn bug: omp streams the ASSISTANT segment before it
      // re-emits the user turn, so the first assistant `message_update` dropped
      // the mark and the user echo that followed found no bubble to reconcile
      // into — it appended a second one. The timeline then showed the turn
      // twice, and the jump rail listed it twice (`/api/chat/:id/turns` merges
      // the stored optimistic row onto the JSONL echo only when the two relate,
      // and a row already carrying omp's id relates to nothing). Measured on
      // this install: `{"msg-…-user","lanjut"}` and `{"omp-id","lanjut"}` side
      // by side in the same overlay, and both listed in the rail.
      //
      // Leaving it set is safe: it is a per-send slot, overwritten by the next
      // send and cleared at `agent_end`, and the user branch consumes it only
      // for the id it actually names.
      queueStreamingUpdate(prev => {
        const placeholderId = aiPlaceholderIdRef.current;
        // Notice rows (e.g. background job done, system alerts) are appended in
        // arrival order — the timeline renders state as-is, so omp's own write
        // order is what the user sees.
        if (isNoticeRow(msg)) {
          if (prev.some(m => m.id === msg.id)) return prev;
          // If an active AI placeholder is generating at the tail, insert notice immediately before it
          if (placeholderId && prev.some(m => m.id === placeholderId)) {
            const pIdx = prev.findIndex(m => m.id === placeholderId);
            return [...prev.slice(0, pIdx), msg, ...prev.slice(pIdx)];
          }
          return [...prev, msg];
        }
        // User turns from the stream (steering abort_and_prompt, queue
        // follow-up deliveries) carry no optimistic bubble — append them
        // wholesale. Never merge into the AI placeholder slot: that would
        // overwrite the streaming AI segment (the omp user id also differs).
        if (msg.role === 'user') {
          if (prev.some(m => m.id === msg.id)) return prev;
          // omp echoes the prompt with a different id than the optimistic
          // bubble (`msg-…-user` vs omp's timestamp id), so reconcile in place
          // instead of appending a duplicate when the echo arrives.
          const pendingId = optimisticUserIdRef.current;
          if (pendingId) {
            const pIdx = prev.findIndex(m => m.id === pendingId);
            if (pIdx !== -1) {
              // Consumed: this echo is the turn the mark stood for, so a later
              // user frame (a genuine steering delivery) appends normally
              // instead of reconciling into a row that is already final.
              optimisticUserIdRef.current = null;
              const reconciled: ChatMessageData = {
                ...msg,
                id: msg.id,
                content: prev[pIdx].content,
                date: prev[pIdx].date,
                attachments: msg.attachments?.length ? msg.attachments : prev[pIdx].attachments,
              };
              return [...prev.slice(0, pIdx), reconciled, ...prev.slice(pIdx + 1)];
            }
          }
          // Steering/follow-up user turns have no optimistic bubble → append
          // the raw composer text recorded at send time, not omp's echo.
          const override = pendingUserDisplaysRef.current.find(
            (e) => msg.content === e.sent || msg.content.startsWith(e.sent) || e.sent.startsWith(msg.content),
          );
          const userMsg = override ? { ...msg, content: override.display } : msg;
          if (placeholderId && prev.some(m => m.id === placeholderId)) {
            const pIdx = prev.findIndex(m => m.id === placeholderId);
            return [...prev.slice(0, pIdx), userMsg, ...prev.slice(pIdx)];
          }
          return [...prev, userMsg];
        }
        if (placeholderId && prev.some(m => m.id === placeholderId)) {
          return prev.map(m => (m.id === placeholderId ? msg : m));
        }
        // omp emits one message_update per segment, each a distinct message
        // id carrying that segment's FULL accumulated content. Same id →
        // in-place update; a new id → append (replacing the trailing AI
        // message would wipe the previous segment's thinking/tool bubbles).
        const existingIdx = prev.findIndex(m => m.id === msg.id);
        if (existingIdx !== -1) {
          return [...prev.slice(0, existingIdx), msg, ...prev.slice(existingIdx + 1)];
        }
        return [...prev, msg];
      }, msg.id);
    },
    onMessageEnd: (msg) => {
      // Apply any coalesced update before the terminal frame so the last chunk
      // is never dropped and the end always runs after it.
      flushStreamingUpdates();
      // The optimistic mark is NOT cleared here either: `agent_end` owns that,
      // and the user branch below consumes it on the echo it belongs to. See
      // `onMessageUpdate` for why an assistant frame must not release it.
      setLocalMessages(prev => {
        const placeholderId = aiPlaceholderIdRef.current;
        // User turn finalization (steering/follow-up): same contract as the
        // update path — append-only, deduped by omp id, placeholder untouched.
        if (msg.role === 'user') {
          const pendingId = optimisticUserIdRef.current;
          let next: ChatMessageData[];
          if (prev.some(m => m.id === msg.id)) {
            next = prev.map(m => (m.id === msg.id ? msg : m));
          } else if (pendingId && prev.some(m => m.id === pendingId)) {
            optimisticUserIdRef.current = null;
            next = prev.map(m => (m.id === pendingId
              ? { ...msg, id: msg.id, content: m.content, date: m.date, attachments: msg.attachments?.length ? msg.attachments : m.attachments }
              : m));
          } else if (placeholderId && prev.some(m => m.id === placeholderId)) {
            const pIdx = prev.findIndex(m => m.id === placeholderId);
            next = [...prev.slice(0, pIdx), msg, ...prev.slice(pIdx)];
          } else {
            next = [...prev, msg];
          }
          persistMessages(next);
          return next;
        }
        let updated: ChatMessageData[];
        if (placeholderId && prev.some(m => m.id === placeholderId)) {
          updated = prev.map(m => (m.id === placeholderId ? msg : m));
        } else {
          // omp emits one message_end per segment, each a distinct message
          // id carrying that segment's FULL accumulated content. Same id →
          // in-place finalize; a new id → append so segments of the same
          // turn stack (thinking/tool bubbles from earlier segments survive).
          const existingIdx = prev.findIndex(m => m.id === msg.id);
          if (existingIdx !== -1) {
            updated = [...prev.slice(0, existingIdx), msg, ...prev.slice(existingIdx + 1)];
          } else {
            updated = [...prev, msg];
          }
        }
        aiPlaceholderIdRef.current = null;
        persistMessages(updated);
        return updated;
      });
    },
    onAgentEnd: () => {
      disposeStreamingCoalescer();
      setGenerating(false);
      abortControllerRef.current = null;
      optimisticUserIdRef.current = null;
      pendingUserDisplaysRef.current = [];
      triggerChatCompletionSound(appSettings);
      setTimeout(() => scrollToBottom('smooth'), 50);
      // The sidebar's spinner is NOT released here: it never was armed from
      // this side. The server's `stream` row is released by its own terminal
      // `agent_end` fold (`markEndStatus`), which is what the sidebar and the
      // generating indicator both read.
      // The omp JSONL has the final title/messages now — refresh session
      // metadata so navbar/context panel show the real title. A fresh spawn
      // ("new-…" → UUID) may not have re-rendered the URL yet, so prefer the
      // adopted id like onAgentStart/onModelChanged do — otherwise this
      // fetches the pending id and finds no session, so the sidebar keeps its
      // placeholder until the realtime scan surfaces the row.
      const sid = adoptedSessionIdRef.current ?? sessionIdRef.current;
      if (sid) refreshSessionMeta(sid);
    },
    onModelChanged: () => {
      // omp's model_changed frame carries no payload — re-read the session
      // metadata so the indicator/composer reflect the live model.
      const sid = adoptedSessionIdRef.current ?? sessionIdRef.current;
      if (sid) setTimeout(() => refreshSessionMeta(sid), 150);
    },
    onPromptError: (errorMessage) => {
      setGenerating(false);
      abortControllerRef.current = null;
      console.error('OMP prompt error:', errorMessage);
    },
    // The prompt ran a built-in slash command (omp answered on the command
    // path, no agent run): drop the optimistic AI placeholder and settle the
    // optimistic user row — it stays as the record of what the user invoked.
    onPromptSettled: () => {
      disposeStreamingCoalescer();
      setGenerating(false);
      abortControllerRef.current = null;
      optimisticUserIdRef.current = null;
      const placeholderId = aiPlaceholderIdRef.current;
      aiPlaceholderIdRef.current = null;
      if (placeholderId) {
        setLocalMessages(prev => {
          if (!prev.some(m => m.id === placeholderId)) return prev;
          return prev.filter(m => m.id !== placeholderId);
        });
      }
    },
    // Built-in slash command output: a notice row, persisted — see the module
    // doc for why the chamber's own copy is the only place it can survive.
    onCommandOutput: (text) => {
      appendNoticeRow(text, { setLocalMessages, aiPlaceholderIdRef, persistMessages });
    },
    // A provider retry saga: one row per saga (the fold calls this on the
    // frame's `attempt === 1`), so a session reloaded afterwards still records
    // why an answer took minutes to arrive. See `provider-retry.ts`.
    onProviderRetry: (info) => {
      appendNoticeRow(retryNotice(info), { setLocalMessages, aiPlaceholderIdRef, persistMessages });
    },
    // omp renamed the session — the auto-title generation the chamber asks for
    // after a settled run, a `/rename`, or an RPC set_session_name. The slot
    // write is in place, so the title is already on disk: refresh the metadata
    // the navbar/context panel read, and signal the sidebar (whose scan cache
    // is keyed on file mtime, which a fixed-width in-place write cannot move).
    onSessionTitleChanged: () => {
      const sid = adoptedSessionIdRef.current ?? sessionIdRef.current;
      if (sid) refreshSessionMeta(sid);
    },
    onNotice: (_level, message) => {
      console.info('OMP notice:', message);
    },
    onExtensionUiRequest: (request: IncomingExtensionUiRequest) => {
      // The blocking-method list is SHARED with the server
      // (`@/shared/lib/omp/dialog-methods`): a method one half lists and the
      // other does not is a dialog remembered on one side and dropped on the
      // other. The grouped `ask` frame (`set_ask_dialog`) was missing from this
      // local copy, so it never reached the queue and its card rendered every
      // question as "Waiting for the previous answer…" with nothing to answer.
      if (isAnswerableUiRequest(request)) {
        enqueueExtensionDialog(request);
      } else if (request.method === 'cancel') {
        withdrawExtensionDialog(request.targetId);
      }
    },
  };
}
