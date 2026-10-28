/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Queue-row actions for the chat timeline: editing a queued item back into the
 * composer, and delivering one immediately.
 *
 * Split out of `actions.ts` so that hook keeps to the repo's per-file ceiling.
 * Both handlers take the same deps record, and both are about ONE row of the
 * follow-up queue rather than about the composer's own send path — which is the
 * seam this file draws.
 */

import type { Dispatch, SetStateAction } from 'preact/compat';
import type { Attachment, PromptDispatchResult, QueuedMessageModel } from '@/shared/types';
import type { QueuedMessage } from '@/client/components/workspace/chat-timeline/QueueList';
import { reportSteerOutcome } from '@/shared/lib/chat/timeline/steer-report';

export interface QueueActionsDeps {
  setInputValue: (v: string) => void;
  setInputAttachments: Dispatch<SetStateAction<Attachment[]>>;
  removeMessage: (id: string) => void;
  /** Armed by Stop; the queue auto-process holds off while it is set. */
  stopHoldRef: { current: boolean };
  isGenerating: boolean;
  isOmpSession: boolean;
  steerOmpAgent: (text: string, attachments: Attachment[]) => Promise<PromptDispatchResult>;
  abortControllerRef: { current: AbortController | null };
  setGenerating: (v: boolean) => void;
  /** Surface a delivery that failed (a refused steer removes the row first). */
  reportActionError: (message: string) => void;
  executeSend: (
    text: string,
    attachments: Attachment[],
    options?: { model?: QueuedMessageModel | null },
  ) => Promise<PromptDispatchResult>;
}

export interface QueueActions {
  handleEditQueueItem: (item: QueuedMessage) => void;
  handleSendNowQueueItem: (item: QueuedMessage) => Promise<void>;
}

export function createQueueActions(deps: QueueActionsDeps): QueueActions {
  const {
    setInputValue,
    setInputAttachments,
    removeMessage,
    stopHoldRef,
    isGenerating,
    isOmpSession,
    steerOmpAgent,
    abortControllerRef,
    setGenerating,
    reportActionError,
    executeSend,
  } = deps;
  return {
    /** Lift the row's text into the composer and drop the row. If the user
     *  never re-submits, the delete already removed it — the old flow had a
     *  dead window here where removing from the local list was the only edit. */
    handleEditQueueItem: (item) => {
      setInputValue(item.text);
      setInputAttachments(item.attachments);
      removeMessage(item.id);
    },

    /** Deliver one row now, ahead of the queue. Explicit delivery also lifts
     *  the Stop hold, so the auto-process may resume after this run ends.
     *
     *  The row is removed BEFORE the steer goes out (the user asked for it to
     *  leave the queue), so a refusal has to be reported — otherwise the item
     *  is gone and nothing ran. */
    handleSendNowQueueItem: async (item) => {
      stopHoldRef.current = false;
      removeMessage(item.id);

      if (isGenerating) {
        if (isOmpSession) {
          reportSteerOutcome(await steerOmpAgent(item.text, item.attachments), reportActionError);
        } else {
          if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
          }
          setGenerating(false);
          setTimeout(() => executeSend(item.text, item.attachments, { model: item.model }), 0);
        }
      } else {
        executeSend(item.text, item.attachments, { model: item.model });
      }
    },
  };
}
