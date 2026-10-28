/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `command_output` fold step: a builtin command's result becomes a notice
 * row — and the shared helper every notice row goes through (a provider retry
 * saga uses the same one; see `provider-retry.ts`).
 *
 * Persistence is the point. omp answers a builtin on the command path and
 * writes nothing to the session JSONL — the output exists only in this frame —
 * so a timeline rebuilt from the file had forgotten a `/context` the user just
 * ran. The Kabmo's own copy keeps it, and `mergeOmpAttachments` splices it
 * back under the turn that produced it on the next load.
 *
 * Split out of `omp-callbacks.ts` (which keeps only the wiring) so both files
 * stay under the repo's per-file size ceiling.
 */

import type { Dispatch, SetStateAction } from 'preact/compat';
import type { ChatMessageData } from '@/shared/types';

export interface NoticeRowDeps {
  setLocalMessages: Dispatch<SetStateAction<ChatMessageData[]>>;
  /** The optimistic AI bubble this run is streaming into, if any. */
  aiPlaceholderIdRef: { current: string | null };
  persistMessages: (messages: ChatMessageData[]) => void;
}

/**
 * Append a notice row to the timeline, before the active placeholder.
 *
 * The row is PERSISTED for the same reason every notice is: the frame that
 * carries it exists only on the live stream (omp writes no entry for a builtin
 * command, and a provider retry is not conversation at all), so a timeline
 * rebuilt from the session file would have forgotten it. `mergeOmpAttachments`
 * splices it back under the turn that produced it.
 *
 * Placing it before the placeholder is what keeps it under the turn that
 * produced it: the placeholder becomes the assistant's answer, and the notice
 * must read as the command's result rather than as part of that answer. With no
 * placeholder the row goes at the tail.
 */
export function appendNoticeRow(text: string, deps: NoticeRowDeps): void {
  const { setLocalMessages, aiPlaceholderIdRef, persistMessages } = deps;
  const row: ChatMessageData = {
    id: `cmdout-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: 'ai',
    content: '',
    notice: text,
  };
  setLocalMessages(prev => {
    const placeholderId = aiPlaceholderIdRef.current;
    const pIdx = placeholderId ? prev.findIndex(m => m.id === placeholderId) : -1;
    if (pIdx !== -1) {
      const next = [...prev.slice(0, pIdx), row, ...prev.slice(pIdx)];
      // The streaming placeholder is deliberately NOT persisted — it is a
      // client-side bubble that `onPromptSettled` removes, and executeSend
      // filters it for the same reason. Writing it here left an empty assistant
      // row in Kabmo's copy of a command-only turn.
      //
      // Safe inside the updater: `row` is built once, so re-applying the same
      // updater produces the identical array — this is a full-array overwrite,
      // not an append that could double. A side effect that must happen exactly
      // once (a send, a rewind) never belongs in an updater; see
      // `actions.handleRetry`.
      persistMessages(next.filter(m => m.id !== placeholderId));
      return next;
    }
    // Already recorded (the same command re-run while nothing streams): keep
    // the list as-is rather than stacking an identical card.
    if (prev.some(m => m.notice === text)) return prev;
    const next = [...prev, row];
    persistMessages(next);
    return next;
  });
}
