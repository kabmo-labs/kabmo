/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A document review as the text the agent receives.
 *
 * The same shape the browser panel's page context uses: the judgements become
 * PROMPT TEXT in the composer draft, never a second store the agent has to be
 * taught to read. Each line names the block by its line range and quotes it, so
 * the agent can find the paragraph without counting, and each mark says which
 * answer was chosen in words (`good`, `needs work`) rather than a glyph alone.
 *
 * The closing instruction is load-bearing: without it, a list of verdicts reads
 * as a description of the document instead of a decision about it — and a
 * `good` block is exactly the instruction "leave this alone".
 */

import type { BlockVerdict, DocumentAnnotation } from '@/shared/lib/markdown/blocks/types';

/** One `scope\0repo` pair as the prompt spells it: a path a reader can act on. */
export interface ReviewPromptDocument {
  /** The document's path, relative to the workspace (or nested repo). */
  path: string;
  annotations: readonly Pick<DocumentAnnotation, 'lineStart' | 'lineEnd' | 'verdict' | 'note' | 'quote'>[];
}

const VERDICT_LABEL: Record<BlockVerdict, string> = {
  good: 'good — leave it as it is',
  'needs-work': 'needs work',
};

function rangeOf(annotation: ReviewPromptDocument['annotations'][number]): string {
  return annotation.lineStart === annotation.lineEnd
    ? `L${annotation.lineStart}`
    : `L${annotation.lineStart}-${annotation.lineEnd}`;
}

/**
 * The block this review adds to the draft; empty when nothing was judged.
 *
 * An empty review produces NO text rather than a header claiming zero marks: the
 * button that sends it is disabled in that state, and a stray header would be
 * something the user has to delete before typing.
 */
export function formatReviewBlock(document: ReviewPromptDocument): string {
  const marks = document.annotations.filter((annotation) => annotation.verdict === 'good' || annotation.verdict === 'needs-work');
  if (marks.length === 0) return '';
  const lines = marks.map((annotation) => {
    const quote = annotation.quote ? ` «${annotation.quote}»` : '';
    const note = annotation.note.trim();
    return `- ${rangeOf(annotation)}${quote} — ${VERDICT_LABEL[annotation.verdict]}${note ? `: ${note}` : ''}`;
  });
  return [
    `[Review dokumen] ${document.path}`,
    ...lines,
    'Ini keputusan user atas blok-blok di atas: blok bertanda "needs work" perlu diperbaiki sesuai catatannya, blok bertanda "good" jangan diubah.',
  ].join('\n');
}

/** A blank draft gets the block alone; otherwise one blank line separates them. */
export function appendReviewBlock(previous: string, block: string): string {
  if (!block) return previous;
  if (!previous) return block;
  const separator = previous.endsWith('\n\n') ? '' : previous.endsWith('\n') ? '\n' : '\n\n';
  return `${previous}${separator}${block}`;
}

/** DOM event a document review dispatches to append its block to the draft. */
export const REVIEW_INCLUDE_EVENT = 'omp:review-include';

/** Hand a finished review to the composer, whichever tree is listening. */
export function emitReviewBlock(block: string): void {
  if (typeof window === 'undefined' || !block) return;
  window.dispatchEvent(new CustomEvent<string>(REVIEW_INCLUDE_EVENT, { detail: block }));
}
