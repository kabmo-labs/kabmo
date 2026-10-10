/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * One question of an `ask` call, in whichever of its four states it is in:
 * answered (omp already recorded it), asking (its dialog is live), still queued
 * behind an earlier question (omp asks them strictly in order, so the later
 * ones can only be previewed until their turn comes) or abandoned — the ask
 * ended without reaching it, so no dialog can arrive again.
 */

import { Ban, CheckCircle2, Clock } from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import { MarkdownRenderer } from '@/client/components/common/MarkdownRenderer';
import type { ExtensionUiDialogRequest } from '@/shared/types/omp/agent';
import type { AskAnswer, AskQuestion } from '@/shared/lib/chat/ask-questions';
import { FrameControl } from '@/client/components/workspace/chat-timeline/tool-renderers/ask-panel/FrameControl';
import type { ExtensionDialogResponse } from '@/client/components/workspace/chat-timeline/tool-renderers/extension-dialog/Lazy';

interface QuestionBlockProps {
  index: number;
  total: number;
  question: AskQuestion;
  /** Dialogs this question raised, oldest first; the last one is live. */
  frames: ExtensionUiDialogRequest[];
  recorded: AskAnswer | null;
  /** Answer picked locally for a question omp has not reached yet. */
  draft?: string;
  /** Unanswered, but omp has already moved past it — its dialog is gone. */
  passed: boolean;
  /**
   * The ask's tool call already failed or was aborted: omp withdrew its dialog
   * and cannot raise another, so an unanswered question is not queued behind
   * anything.
   */
  settled: boolean;
  /** Labels toggled locally on a multi-select question. */
  multiSelected: string[];
  /**
   * The `pendingInteraction` slot's controls for the live dialog, if any.
   *
   * An element, not a component rendered here: it sits above the human's own
   * control and OUTSIDE the plugin boundary, so a plugin that threw cannot take
   * the question off screen.
   */
  interactions?: ComponentChildren;
  onAnswer: (value: string) => void;
  onToggle: (label: string) => void;
  onRespond: (response: ExtensionDialogResponse) => void;
}

function answerParts(answer: AskAnswer): string[] {
  const parts = [...answer.selectedOptions];
  if (answer.customInput) parts.push(answer.customInput);
  return parts;
}

export function QuestionBlock({
  index,
  total,
  question,
  frames,
  recorded,
  draft,
  passed,
  settled,
  multiSelected,
  interactions,
  onAnswer,
  onToggle,
  onRespond,
}: QuestionBlockProps) {
  const live = frames.length > 0 ? frames[frames.length - 1] : null;
  // A recorded answer with no labels is still an answer — omp accepts an empty
  // multi-select as "select none" — so presence, never the rendered part count,
  // decides whether a question is answered. Reading the parts made such a
  // question fall through to the queued state and claim a dialog was live.
  const hasAnswer = recorded !== null || draft !== undefined || multiSelected.length > 0;
  const parts = recorded ? answerParts(recorded) : draft ? [draft] : multiSelected;
  const chips = parts.length > 0 ? parts : ['none selected'];
  // A settled ask has no live dialog by construction, even if a frame this
  // client never saw withdrawn is still in its queue: answering it would post
  // a response for a tool call omp has already finished.
  const asking = !settled && Boolean(live) && !recorded && (question.multi || !draft);

  return (
    <div className="rounded-lg border border-ink/10 bg-paper p-2.5 shadow-xs">
      <div className="flex items-start gap-2">
        <span className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded bg-ink/5 font-mono text-[9px] font-semibold text-ink/60">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] font-semibold uppercase tracking-wider text-ink/40">
              {question.header ?? `Question ${index + 1}`}
            </span>
            {question.multi && (
              <span className="rounded-full bg-ink/5 px-1.5 py-px font-mono text-[8.5px] text-ink/45">multi</span>
            )}
            {total > 1 && (
              <span className="ml-auto font-mono text-[9px] text-ink/35">
                {index + 1}/{total}
              </span>
            )}
          </div>

          <div className="mt-1 text-[12.5px] leading-relaxed text-ink/90 select-text">
            <MarkdownRenderer content={question.question} />
          </div>

          {asking && live && (
            <>
              {interactions}
              <FrameControl
                frame={live}
                multi={question.multi}
                selected={multiSelected}
                onAnswer={onAnswer}
                onToggle={onToggle}
                onRespond={onRespond}
              />
            </>
          )}

          {hasAnswer && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <CheckCircle2 size={11} className="shrink-0 text-success" />
              {chips.map((part) => (
                <span
                  key={part}
                  className="rounded-md border border-ink/12 bg-canvas/40 px-2 py-0.5 text-[11.5px] font-medium text-ink select-text"
                >
                  {part}
                </span>
              ))}
              {recorded?.timedOut && (
                <span className="rounded-full bg-ink/5 px-1.5 py-px font-mono text-[9px] text-ink/45">
                  auto-selected on timeout
                </span>
              )}
            </div>
          )}

          {!asking && !hasAnswer && passed && (
            <div className="mt-2 flex items-center gap-1.5 text-[10.5px] text-ink/45">
              <CheckCircle2 size={11} className="shrink-0 text-ink/35" />
              <span>Answered earlier in this run.</span>
            </div>
          )}

          {!asking && !hasAnswer && !passed && (
            <div className="mt-2 space-y-1 border-t border-ink/6 pt-2">
              {question.options.map((option, optionIndex) => (
                <div key={option.label} className="flex items-start gap-2 px-0.5 text-[11.5px] text-ink/45">
                  <span className="mt-1 h-3 w-3 shrink-0 rounded-full border border-ink/20" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">
                      {option.label}
                      {question.recommended === optionIndex && (
                        <span className="ml-1.5 font-mono text-[9px] uppercase tracking-wider text-ink/35">
                          suggested
                        </span>
                      )}
                    </span>
                    {option.description && (
                      <span className="mt-0.5 block text-[10.5px] leading-relaxed text-ink/35">
                        {option.description}
                      </span>
                    )}
                  </span>
                </div>
              ))}
              {/* "Waiting for the previous answer" is only true while the ask
                  is still running: once it settles nothing is being asked, and
                  the question was abandoned unanswered. */}
              {settled ? (
                <div className="flex items-center gap-1.5 pt-0.5 text-[10.5px] text-ink/40">
                  <Ban size={10} className="shrink-0" />
                  <span>Not answered — the ask was cut short.</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 pt-0.5 text-[10.5px] text-ink/40">
                  <Clock size={10} className="shrink-0" />
                  <span>Waiting for the previous answer…</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
