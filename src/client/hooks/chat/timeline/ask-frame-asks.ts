/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `ask` tool calls a dialog may belong to, read from the timeline.
 *
 * Split from `ask-frames.ts` (which owns the routing decision) because the two
 * ask sets answer different questions and both are read on every pending frame:
 *
 *  - `openAsks` are the calls that can still OWN a dialog: not settled, and not
 *    already carrying an answer for every question.
 *  - `allAsks` are every ask, settled ones included. A dialog whose call just
 *    failed is still that ask's dialog, so it belongs on the timeline (an
 *    inline orphan) rather than in the modal.
 *
 * Each entry also carries the call's `html` when it has one, because omp
 * 19.1.0's whole-form frame (`method:"form"`) names no question: its `html` is
 * the same string the tool call's arguments carry, and that is the only key
 * both sides hold.
 */

import type { ChatMessageData } from '@/shared/types';
import type { AskQuestion } from '@/shared/lib/chat/ask-form/types';
import { isAskSettled, isAskToolCall, parseAskQuestions } from '@/shared/lib/chat/ask-questions';
import { parseAskResult } from '@/shared/lib/chat/ask-results';

/** One ask tool call, as a dialog's potential owner. */
export interface AskCall {
  toolId: string;
  questions: AskQuestion[];
  /** The `html` the call asked with, when it is the form shape. */
  html?: string;
}

export interface AskIndex {
  /** Calls that can still own a dialog. */
  openAsks: AskCall[];
  /** Every ask, settled ones included. */
  allAsks: AskCall[];
}

/** Index the timeline's ask tool calls by what a pending dialog may claim. */
export function collectAsks(messages: ChatMessageData[]): AskIndex {
  const openAsks: AskCall[] = [];
  const allAsks: AskCall[] = [];
  for (const message of messages) {
    for (const tool of message.toolCalls ?? []) {
      if (!isAskToolCall(tool)) continue;
      const questions = parseAskQuestions(tool);
      if (questions.length === 0) continue;
      const input = tool.input as Record<string, unknown> | undefined;
      const html = typeof input?.html === 'string' ? input.html : undefined;
      const entry: AskCall = { toolId: tool.id, questions, ...(html ? { html } : {}) };
      allAsks.push(entry);
      // A settled call is not a candidate at all: a validation failure leaves a
      // dead call (`status: 'error'`) whose card renders no control, so letting
      // it claim the retry's dialog left the live card waiting forever. A call
      // read back from the JSONL while still parked is neither — omp writes no
      // result until the question is answered.
      if (isAskSettled(tool)) continue;
      if (parseAskResult(tool, questions).every((answer) => answer !== null)) continue;
      openAsks.push(entry);
    }
  }
  return { openAsks, allAsks };
}
