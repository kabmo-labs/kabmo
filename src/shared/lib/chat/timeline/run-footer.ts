/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Run-footer placement for the chat timeline. The model/duration/token footer
 * closes an AI response run, so it is emitted at the run's boundary — after
 * every row the run owns, including notice rows omp wrote at its tail, and
 * therefore immediately before the next user message. Nothing here reorders
 * rows: the timeline renders file order and the footer is an extra row placed
 * after the run's last one.
 *
 * "Notice row" means a real notice card: a row whose `notice` carries the
 * answer instead is an ordinary AI row and owns its run (chat/notice-row.ts).
 */

import { responseRunDurationMs } from '@/shared/lib/chat/duration';
import { isNoticeRow, messageAnswerText } from '@/shared/lib/chat/notice-row';
import type { ChatMessageData } from '@/shared/types';

export interface RunFooterSlot {
  /** The run's last real AI message — the row carrying model/usage/duration. */
  msg: ChatMessageData;
  /** Index of that message, i.e. the row that streams during generation. */
  ownerIndex: number;
  /** Measured run span, falling back to the turn's own recorded duration. */
  durationMs: number | null;
  /**
   * Index of the USER row that opened this run, or -1 when the run has none
   * (a session file that starts mid-run). This is the row Retry rewinds to:
   * a run spans several AI rows — thinking, tool calls, the answer — so the
   * owner row is almost never the one a user turn sits in front of.
   */
  runStartIndex: number;
  /** `runStartIndex`'s row id, `''` when the run has no user row. */
  runUserId: string;
  /**
   * The run's WHOLE answer — every non-notice row's text, in order — which is
   * what Copy and "new chat from this answer" act on. Reading only the owner
   * row copied the last segment of a multi-segment run (or nothing at all when
   * that segment carried only tool calls).
   */
  answerText: string;
}

/**
 * Text of a run's answer: every non-notice row between its opening user row and
 * its owner row. Notice rows carry reminders and command output, never the
 * answer, so they are excluded — except one that carries the answer itself,
 * which `isNoticeRow` already reports as an ordinary AI row.
 */
function runAnswerText(messages: ChatMessageData[], startIndex: number, ownerIndex: number): string {
  const parts: string[] = [];
  for (let i = Math.max(0, startIndex); i <= ownerIndex; i++) {
    const msg = messages[i];
    if (!msg || msg.role === 'user' || isNoticeRow(msg)) continue;
    const text = messageAnswerText(msg).trim();
    if (text) parts.push(text);
  }
  return parts.join('\n\n');
}

/**
 * The row that streams while generating: the last non-notice row. Notice rows
 * sit after the turn, so a plain "last item" check would mark a notice as the
 * streaming row and settle the footer early.
 */
export function streamingRowIndex(messages: ChatMessageData[]): number {
  let index = messages.length - 1;
  while (index >= 0 && isNoticeRow(messages[index])) index--;
  return index;
}

/**
 * `previousNonNoticeIndex[idx]`: nearest non-notice row index strictly BEFORE
 * idx, or -1 when none. Rows use it to tell an assistant continuation from a
 * fresh turn without re-scanning the timeline per row.
 */
export function previousNonNoticeIndex(messages: ChatMessageData[]): number[] {
  const indexes: number[] = new Array(messages.length);
  let prevIdx = -1;
  for (let i = 0; i < messages.length; i++) {
    indexes[i] = prevIdx;
    if (!isNoticeRow(messages[i])) prevIdx = i;
  }
  return indexes;
}

/**
 * One entry per timeline index: non-null when a run footer renders AFTER that
 * row. A run is a maximal stretch of non-user rows; its footer lands on the
 * run's last row, so trailing notice rows no longer separate the footer from
 * the following user message. A notice-only run gets none (no AI message to
 * describe), and a run that is still generating is skipped until it settles.
 */
export function resolveRunFooters(
  messages: ChatMessageData[],
  isGenerating: boolean,
): (RunFooterSlot | null)[] {
  const count = messages.length;
  const footers: (RunFooterSlot | null)[] = new Array(count).fill(null);
  const streamingIdx = streamingRowIndex(messages);
  let ownerIndex = -1;
  // Index of the user row that opened the current run. Notice rows never reset
  // it: a reminder omp writes mid-run belongs to the run it interrupts, and
  // resetting there would lose the turn Retry has to rewind to.
  let runStartIndex = -1;

  for (let i = 0; i < count; i++) {
    const msg = messages[i];
    if (msg.role === 'user') {
      ownerIndex = -1;
      runStartIndex = i;
      continue;
    }
    if (!isNoticeRow(msg)) ownerIndex = i;

    const endsRun = i === count - 1 || messages[i + 1]?.role === 'user';
    if (!endsRun || ownerIndex < 0) continue;

    const owner = messages[ownerIndex];
    // The answer is still streaming — no footer until the run settles. The
    // streaming row is identified POSITIONALLY, never by its role spelling: a
    // live row is `ai` (the live mapper), while `roleFor` spells the rows a
    // JSONL load produces for omp's `developer`, `custom` and `toolResult`
    // entries `assistant` — and a run reopened mid-flight has exactly such a
    // row at its tail (the last entry written before the streaming answer).
    // Gating on `ai` therefore settled the footer on the very row that was
    // still streaming. `ownerIndex` only ever holds a non-user, non-notice
    // row, so no role test is needed here.
    if (isGenerating && ownerIndex === streamingIdx) continue;

    const runUser = runStartIndex >= 0 ? messages[runStartIndex] : null;
    footers[i] = {
      msg: owner,
      ownerIndex,
      durationMs: responseRunDurationMs(messages, ownerIndex) ?? owner.durationMs ?? null,
      runStartIndex,
      runUserId: runUser?.id ?? '',
      answerText: runAnswerText(messages, runStartIndex, ownerIndex),
    };
  }

  return footers;
}
