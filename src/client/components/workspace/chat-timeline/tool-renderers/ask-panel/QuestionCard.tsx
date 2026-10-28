/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The card ONE `ask` question is drawn in, and the answer it shows once it is
 * answered — shared by the per-question path (`QuestionBlock`) and the grouped
 * one (`GroupedAsk`).
 *
 * omp has TWO shapes for the same tool (see `ask-questions.ts`), and a question
 * must read the same in both: a numbered card carrying the question's header
 * chip, its prose, and whatever control or answer belongs under it. Drawing
 * them separately is how the grouped card drifted into a different-looking
 * feature — a compact chip strip beside a standalone ask card.
 *
 * The answer is STACKED, one row per part, never wrapped across the card: a
 * picked label plus typed text in a `flex-wrap` row reads as one run-on
 * sentence, and the block exists to show which question got which answer.
 */

import type { ComponentChildren } from 'preact';
import { CheckCircle2 } from 'lucide-preact';
import { MarkdownRenderer } from '@/client/components/common/MarkdownRenderer';

interface QuestionCardProps {
  index: number;
  total: number;
  header?: string;
  question: string;
  multi: boolean;
  /** omp — or a local submit — has an answer for this question. */
  answered?: boolean;
  /** The question's own control and/or its answer, below the prose. */
  children: ComponentChildren;
}

export function QuestionCard({ index, total, header, question, multi, answered, children }: QuestionCardProps) {
  return (
    <div className="rounded-lg border border-ink/10 bg-paper p-2.5 shadow-xs">
      <div className="flex items-start gap-2">
        <span className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded bg-ink/5 font-mono text-[9px] font-semibold text-ink/60">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] font-semibold uppercase tracking-wider text-ink/40">
              {header ?? `Question ${index + 1}`}
            </span>
            {multi && (
              <span className="rounded-full bg-ink/5 px-1.5 py-px font-mono text-[8.5px] text-ink/45">multi</span>
            )}
            {answered && (
              <span className="rounded-full bg-success/10 px-1.5 py-px font-mono text-[8.5px] text-success">
                answered
              </span>
            )}
            {total > 1 && (
              <span className="ml-auto font-mono text-[9px] text-ink/35">
                {index + 1}/{total}
              </span>
            )}
          </div>

          <div className="mt-1 text-[12.5px] leading-relaxed text-ink/90 select-text">
            <MarkdownRenderer content={question} />
          </div>

          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * A question's answer: one row per part, stacked downward.
 *
 * An empty answer is still an answer — omp accepts an empty multi-select as
 * "select none" — so the CALLER decides presence (a recorded answer with no
 * labels is not the same as no answer) and this renders the rows it is handed.
 */
export function AnswerList({ parts, note }: { parts: string[]; note?: string }) {
  const rows = parts.length > 0 ? parts : ['none selected'];
  return (
    <div className="mt-2 space-y-1">
      {rows.map((part, index) => (
        <div
          key={`${index}:${part}`}
          data-answer-row
          className="flex items-start gap-1.5 rounded-md border border-ink/12 bg-canvas/40 px-2 py-1 text-[11.5px] font-medium text-ink select-text"
        >
          <CheckCircle2 size={11} className="mt-0.5 shrink-0 text-success" />
          <span className="min-w-0 flex-1 break-words">{part}</span>
        </div>
      ))}
      {note && <div className="font-mono text-[9px] text-ink/45">{note}</div>}
    </div>
  );
}
