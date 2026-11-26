/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Where one ask's claimed dialogs sit among its questions.
 *
 * Split from `ask-frames.ts` (which decides WHICH ask a frame belongs to) so
 * each file states one rule. This half takes the frames already owned by one
 * tool call and answers the question the card asks: for each question, the
 * dialogs it raised, in order.
 *
 * Three shapes arrive and each is placed by its own key:
 *
 *  - a GROUPED frame (`method:"ask"`) covers every question it names, so it is
 *    pushed onto each of their buckets rather than onto one;
 *  - a frame claimed by its ROWS already knows its question (`optionPlacements`);
 *  - anything else is the per-question walk's business (`groupAskFrames`), which
 *    follows omp's own forward-moving order.
 *
 * A frame with neither a title nor a row match is not walked at all: it is
 * handed back as `loose`, because the card must draw it as the live control
 * rather than guess a question and print the wrong one as open.
 */

import type { ExtensionUiDialogRequest } from '@kabmo-labs/kabmo-chat/contracts/agent';
import type { AskQuestion } from '@/shared/lib/chat/ask-form/types';
import { groupAskFrames } from '@/shared/lib/chat/ask-questions';

export interface BucketedFrames {
  /** One bucket per question, in form order. */
  perQuestion: ExtensionUiDialogRequest[][];
  /**
   * Frames matched by NEITHER key, which the card draws as the live control
   * (see `looseByTool`). They are deliberately absent from every question
   * bucket: guessing one would print the wrong question as open.
   */
  unmatched: ExtensionUiDialogRequest[];
}

export function bucketAskFrames(
  questions: AskQuestion[],
  frames: readonly ExtensionUiDialogRequest[],
  /** Frames claimed by neither key, which the card draws as the live control. */
  unmatched: ReadonlySet<ExtensionUiDialogRequest>,
  /** Question index per frame claimed by its option rows. */
  optionPlacements: ReadonlyMap<ExtensionUiDialogRequest, number>,
): BucketedFrames {
  const placed: ExtensionUiDialogRequest[][] = questions.map((): ExtensionUiDialogRequest[] => []);
  /** Frames the per-question walk still has to place. */
  const walking: ExtensionUiDialogRequest[] = [];
  const unplaced: ExtensionUiDialogRequest[] = [];
  for (const frame of frames) {
    if (Array.isArray(frame.questions) && frame.questions.length > 0) {
      for (const grouped of frame.questions) {
        const index = questions.findIndex((question) => question.id === grouped.id);
        if (index >= 0) placed[index].push(frame);
        else walking.push(frame);
      }
      continue;
    }
    const byOptions = optionPlacements.get(frame);
    if (byOptions !== undefined) {
      if (placed[byOptions]) placed[byOptions].push(frame);
      else walking.push(frame);
      continue;
    }
    if (unmatched.has(frame)) {
      unplaced.push(frame);
      continue;
    }
    walking.push(frame);
  }
  const walked = groupAskFrames(questions, walking);
  return { perQuestion: questions.map((_, index) => [...placed[index], ...walked[index]]), unmatched: unplaced };
}
