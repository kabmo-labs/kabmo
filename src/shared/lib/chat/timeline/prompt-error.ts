/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Turn a `prompt_error` frame into a row the timeline DRAWS.
 *
 * The frame used to reach `onPromptError` only, which logged it and cleared the
 * generating flag. On an ACP harness a silent failure therefore left the
 * optimistic AI bubble exactly as it was — an empty answer — and the reason
 * lived in the console. The row the answer would have streamed into is where
 * the error belongs: `MessageItem` already draws `msg.error` as the
 * Provider/API Error alert for omp's transcript rows, so this path reuses that
 * renderer instead of inventing a second error card.
 *
 * The placeholder is consumed even when it never received a byte; leaving it
 * armed would let a late frame fill an empty bubble after the error.
 */

import type { Dispatch, SetStateAction } from 'preact/compat';
import type { ChatMessageData } from '@/shared/types';
import { isNoticeRow } from '@/shared/lib/chat/notice-row';
import { formatClock } from '@/shared/lib/format/time';

export interface PromptErrorDeps {
  setLocalMessages: Dispatch<SetStateAction<ChatMessageData[]>>;
  aiPlaceholderIdRef: { current: string | null };
  persistMessages: (messages: ChatMessageData[]) => void;
}

/** A row with nothing the timeline renders: no text, no thinking, no tool. */
function isBlankAnswer(msg: ChatMessageData): boolean {
  if (typeof msg.content === 'string' && msg.content.trim()) return false;
  if (msg.thinking || msg.monologue) return false;
  return !(msg.toolCalls?.length || msg.actions?.length || msg.actions2?.length);
}

/** Tail-most rendered AI row IF it is still blank, else -1. */
function blankAssistantIndex(messages: ChatMessageData[]): number {
  for (let index = messages.length - 1; index >= 0; index--) {
    const msg = messages[index];
    if (msg.role === 'user' || isNoticeRow(msg)) continue;
    return isBlankAnswer(msg) ? index : -1;
  }
  return -1;
}

function errorRow(message: string): ChatMessageData {
  return {
    id: `prompt-error-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: 'ai',
    date: `Today, ${formatClock()}`,
    content: '',
    error: { message },
  };
}

/**
 * Attach the failure to the run's own row, or append a dedicated error row when
 * the run already produced an answer (an agent that dies after replying must
 * not relabel that reply as the failure).
 */
export function reportPromptError(errorMessage: string, deps: PromptErrorDeps): void {
  const message = errorMessage.trim() || 'Prompt failed';
  const placeholderId = deps.aiPlaceholderIdRef.current;
  deps.aiPlaceholderIdRef.current = null;
  const row = errorRow(message);

  deps.setLocalMessages((prev) => {
    const placeholderIndex = placeholderId ? prev.findIndex((msg) => msg.id === placeholderId) : -1;
    const targetIndex = placeholderIndex !== -1 ? placeholderIndex : blankAssistantIndex(prev);
    if (targetIndex === -1) {
      // Two failure frames for one run must not stack two identical cards.
      if (prev[prev.length - 1]?.error?.message === message) return prev;
      const next = [...prev, row];
      deps.persistMessages(next);
      return next;
    }
    const next = prev.map((msg, index) =>
      index === targetIndex
        ? { ...msg, error: { ...(msg.error ?? {}), message: msg.error?.message || message } }
        : msg,
    );
    deps.persistMessages(next);
    return next;
  });
}
