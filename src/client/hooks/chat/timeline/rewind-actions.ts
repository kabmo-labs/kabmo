/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The two footer actions that REWIND a conversation: Undo (rewind to before a
 * user turn and hand its text back to the composer) and Retry (rewind to the
 * turn that opened a run and send it again).
 *
 * They live together because they share the same three load-bearing rules, each
 * of which was a defect when it was missing:
 *
 *  - a real omp session rewinds its JSONL first — dropping only the client's
 *    rows left the abandoned turn on disk, so a reload resurrected the answer
 *    that was supposed to be replaced;
 *  - the id Retry receives is the run's OPENING USER row, not the AI row the
 *    footer describes (a run spans thinking / tool / answer rows, so requiring
 *    the owner's immediate predecessor to be a user turn made the button a
 *    silent no-op on every multi-row run);
 *  - a refusal is REPORTED. Both actions change the agent's context, so a
 *    swallowed failure leaves the user believing the timeline moved.
 *
 * Split out of `actions.ts` so that hook keeps to the repo's per-file ceiling.
 */

import type { Dispatch, SetStateAction } from 'preact/compat';
import type { Attachment, ChatMessageData, OmpAgentHandle, PromptDispatchResult } from '@/shared/types';
import { toAttachmentList } from '@/shared/lib/chat/attachments';
import { requestRewind } from '@/client/hooks/chat/timeline/rewind';

export interface RewindActionsDeps {
  isGenerating: boolean;
  isOmpSession: boolean;
  /** Active session id; the omp paths post the rewind against it. */
  sessionId: string | null;
  ompAgent: OmpAgentHandle;
  abortControllerRef: { current: AbortController | null };
  setGenerating: (v: boolean) => void;
  setInputValue: (v: string) => void;
  setLocalMessages: Dispatch<SetStateAction<ChatMessageData[]>>;
  /** Live mirror of the timeline: the truncated list is computed from it
   *  OUTSIDE a state updater, so the persist that follows cannot run twice. */
  localMessagesRef: { current: ChatMessageData[] };
  persistMessages: (messages: ChatMessageData[]) => void;
  executeSend: (text: string, attachments: Attachment[]) => Promise<PromptDispatchResult>;
  /** Surface a refusal; Undo/Retry must not fail silently. */
  reportActionError: (message: string) => void;
}

export interface RewindActions {
  handleUndo: (msgId: string, content?: string) => Promise<boolean>;
  handleRetry: (msgId: string) => void;
}

export function createRewindActions(deps: RewindActionsDeps): RewindActions {
  const {
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
  } = deps;

  /** Stop the active run: both actions replace the turn it is producing. */
  const stopActiveRun = () => {
    if (!isGenerating) return;
    if (isOmpSession) {
      void ompAgent.abort();
    } else if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setGenerating(false);
  };

  const handleUndo = async (msgId: string, content?: string): Promise<boolean> => {
    stopActiveRun();

    // Real omp sessions rewind in place: POST /api/chat/:sessionId/rewind
    // truncates the session JSONL before the turn (session id unchanged) and
    // respawns the agent on the truncated context. The Kabmo-side truncate
    // below would be undone by the next reload, because the timeline loads
    // from the omp JSONL — not from Kabmo DB copy.
    if (isOmpSession && sessionId) {
      const row = localMessagesRef.current.find((m) => m.id === msgId);
      const result = await requestRewind(sessionId, msgId, row?.startedAt);
      if (!result.ok) {
        // The draft is left ALONE on failure. Putting the text into the
        // composer before a rewind that then failed read as "undo worked" —
        // the user saw their message back in the input while the turn it came
        // from was still in the timeline, and had to clear it by hand.
        reportActionError(`Undo failed: ${result.error}`);
        return false;
      }
      if (content) setInputValue(content);
      // The truncated transcript IS the answer, empty included. The old
      // `length > 0` guard dropped exactly the case that matters most — undoing
      // the turn that opened the session (or its only turn) leaves zero rows on
      // disk, so the client kept its own copy: the undone user bubble and the
      // aborted turn stayed on screen until a reload re-read the file. The
      // server answers `messages: null` only when the re-read failed, and there
      // the previous rows are the best information available.
      if (result.messages) setLocalMessages(result.messages);
      return true;
    }

    if (content) setInputValue(content);

    const before = localMessagesRef.current;
    const idx = before.findIndex((m) => m.id === msgId);
    const next = idx !== -1 ? before.slice(0, idx) : before;
    setLocalMessages(next);
    persistMessages(next);
    return true;
  };

  /**
   * Committed history stores attachment DISPLAY fields, where `id` and `preview`
   * are optional. The send path keys by id and the chip renderer reads the
   * preview, so the list is normalized rather than cast.
   */
  const replayAttachments = (msg: ChatMessageData): Attachment[] => toAttachmentList(msg.attachments);

  const handleRetry = (msgId: string) => {
    stopActiveRun();

    const before = localMessagesRef.current;
    let userIdx = before.findIndex((m) => m.id === msgId);
    if (userIdx < 0) return;
    // Fallback for a caller that still hands over an AI row id: the turn that
    // produced it is the row immediately before.
    if (before[userIdx].role !== 'user') {
      userIdx = before[userIdx - 1]?.role === 'user' ? userIdx - 1 : -1;
    }
    if (userIdx < 0) {
      reportActionError('Retry failed: this run has no user turn to re-run.');
      return;
    }
    const userMsg = before[userIdx];

    const send = async () => {
      if (isOmpSession && sessionId) {
        const result = await requestRewind(sessionId, userMsg.id, userMsg.startedAt);
        if (!result.ok) {
          reportActionError(`Retry failed: ${result.error}`);
          return;
        }
        if (result.messages) setLocalMessages(result.messages);
      } else {
        // Drop the turn from the tail — executeSend re-adds it optimistically;
        // keeping it here would render the same user message twice.
        const next = before.slice(0, userIdx);
        setLocalMessages(next);
        persistMessages(next);
      }
      // Committed history attachments carry the persisted display fields only
      // (no File); executeSend reads them defensively on replay.
      await executeSend(userMsg.content, replayAttachments(userMsg));
    };
    void send();
  };

  return { handleUndo, handleRetry };
}
