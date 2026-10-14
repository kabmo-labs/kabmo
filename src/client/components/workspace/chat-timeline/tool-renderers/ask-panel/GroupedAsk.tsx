/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The GROUPED `ask` control: every question of one `ask` tool call in one
 * place, answered by ONE `answers` response.
 *
 * omp offers two shapes for the same tool. By default it loops one blocking
 * `select` per question (what `FrameControl` + `useAskDrafts` reassemble), and
 * after `set_ask_dialog {enabled:true}` it sends one `extension_ui_request` with
 * `method:"ask"` carrying every question — with `multi` and `recommended` — which
 * is answered by a single `{ answers: [...] }` reply (verified on 18.8.3: two
 * questions, one `multi`, arrived in one frame). The grouped shape is what lets
 * a multi-select question be picked in one pass instead of one round trip per
 * toggle.
 *
 * Each question renders in the SAME card the per-question path draws
 * (`QuestionCard`), so the grouped shape is one `ask` card per question rather
 * than a second, compact-looking feature — and each answer lands under its
 * question as a stacked row (`AnswerList`), never as a chip strip that reads as
 * one run-on sentence.
 *
 * The option labels are omp's own (they are what it compares a response
 * against), and a question's answer is its option labels plus optional free
 * text — `{ id, selectedOptions, customInput }`, one entry per question, in the
 * order the request listed them.
 */

import { useMemo, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { CornerDownLeft } from 'lucide-preact';
import type { ExtensionAskQuestion, ExtensionUiDialogRequest } from '@/shared/types/omp/agent';
import type { AskAnswer } from '@/shared/lib/chat/ask-questions';
import { AnswerList, QuestionCard } from '@/client/components/workspace/chat-timeline/tool-renderers/ask-panel/QuestionCard';
import { OptionRow } from '@/client/components/workspace/chat-timeline/tool-renderers/ask-panel/OptionRow';
import type { ExtensionDialogResponse } from '@/client/components/workspace/chat-timeline/tool-renderers/extension-dialog/Lazy';

interface GroupedAskProps {
  frame: ExtensionUiDialogRequest;
  /** Answers omp already recorded, per question — those rows render settled. */
  recorded: (AskAnswer | null)[];
  /**
   * Answers this client just submitted and omp has not echoed yet. Held by the
   * caller (`AskPanel`), because the frame leaves the pending queue the moment
   * the response is on the wire — long before omp writes the tool result — and
   * without them the card would redraw as unanswered for that window.
   */
  submitted?: { id: string; selectedOptions: string[]; customInput?: string }[] | null;
  onRespond: (response: ExtensionDialogResponse) => void;
  /**
   * The `pendingInteraction` slot's controls, if any.
   *
   * Passed in as an element rather than rendered here, so the plugin surface
   * sits in the ask card's tree — above the human's own buttons, and OUTSIDE
   * the plugin boundary that guards it. A plugin that threw inside this
   * component would take the buttons down with it.
   */
  interactions?: ComponentChildren;
}

interface Draft {
  selected: string[];
  text: string;
}

function answerParts(answer: AskAnswer): string[] {
  const parts = [...answer.selectedOptions];
  if (answer.customInput) parts.push(answer.customInput);
  return parts;
}

/** One question's controls — or, once it has an answer, its stacked rows. */
function QuestionRow({
  question,
  index,
  total,
  draft,
  answer,
  locked,
  onToggle,
  onText,
}: {
  question: ExtensionAskQuestion;
  index: number;
  total: number;
  draft: Draft;
  /** The answer to show: omp's recorded one, else what was just submitted. */
  answer: AskAnswer | null;
  /** A submit is on the wire — the controls stay visible but inert. */
  locked: boolean;
  onToggle: (label: string) => void;
  onText: (value: string) => void;
}) {
  return (
    <QuestionCard
      index={index}
      total={total}
      header={question.header}
      question={question.question}
      multi={question.multi === true}
      answered={answer !== null}
    >
      {answer !== null ? (
        <AnswerList parts={answerParts(answer)} />
      ) : (
        <>
          {/* Same rows the per-question `select` path draws (`FrameControl`):
              a full-width option carrying omp's `description` as VISIBLE text.
              A chip strip put it in a `title` tooltip only, so the tradeoff omp
              writes for each choice was invisible until hovered — and invisible
              entirely on a phone. */}
          <div className="mt-2 space-y-1" role={question.multi === true ? 'group' : 'radiogroup'}>
            {question.options.map((option, optionIndex) => (
              <OptionRow
                key={option.label}
                label={option.label}
                description={option.description}
                multi={question.multi === true}
                checked={draft.selected.includes(option.label)}
                suggested={question.recommended === optionIndex}
                disabled={locked}
                onClick={() => onToggle(option.label)}
              />
            ))}
          </div>

          <input
            type="text"
            value={draft.text}
            disabled={locked}
            placeholder="Or type your own…"
            aria-label={`Your own answer for question ${index + 1}`}
            onInput={(event) => onText(event.currentTarget.value)}
            className="mt-2 w-full rounded-md border border-ink/15 bg-canvas/40 px-2 py-1 text-[11.5px] text-ink outline-none focus:border-ink disabled:opacity-50"
          />
        </>
      )}
    </QuestionCard>
  );
}

export function GroupedAsk({ frame, recorded, submitted, onRespond, interactions }: GroupedAskProps) {
  const questions = useMemo(() => frame.questions ?? [], [frame.questions]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

  const draftFor = (question: ExtensionAskQuestion): Draft => drafts[question.id] ?? { selected: [], text: '' };

  const toggle = (question: ExtensionAskQuestion, label: string) => {
    setDrafts((current) => {
      const draft = current[question.id] ?? { selected: [], text: '' };
      const selected = question.multi
        ? (draft.selected.includes(label)
            ? draft.selected.filter((item) => item !== label)
            : [...draft.selected, label])
        : [label];
      return { ...current, [question.id]: { ...draft, selected } };
    });
  };

  const setText = (question: ExtensionAskQuestion, text: string) => {
    setDrafts((current) => ({ ...current, [question.id]: { ...(current[question.id] ?? { selected: [] }), text } }));
  };

  // The answer a question shows: omp's recorded one first (it is authoritative
  // and survives a reload), else what this client just submitted.
  const answerFor = (question: ExtensionAskQuestion, index: number): AskAnswer | null => {
    const recordedAnswer = recorded[index] ?? null;
    if (recordedAnswer) return recordedAnswer;
    const sent = submitted?.find((entry) => entry.id === question.id);
    if (!sent) return null;
    return {
      selectedOptions: sent.selectedOptions,
      ...(sent.customInput ? { customInput: sent.customInput } : {}),
    };
  };

  // A question is answerable when it has a pick or typed text; omp accepts an
  // empty multi-select as "select none", so nothing is mandatory — the submit
  // is disabled only while there is literally nothing to send.
  const answers = questions.map((question) => {
    const draft = draftFor(question);
    return {
      id: question.id,
      selectedOptions: draft.selected,
      ...(draft.text.trim() ? { customInput: draft.text.trim() } : {}),
    };
  });
  const anyAnswer = answers.some((answer) => answer.selectedOptions.length > 0 || answer.customInput);
  // Every question carries an answer once a submit is in flight, so the card
  // stops drawing controls and shows what was sent.
  const settled = submitted !== null && questions.every((question, index) => answerFor(question, index) !== null);

  return (
    <div className="space-y-2">
      {questions.map((question, index) => (
        <QuestionRow
          key={question.id}
          question={question}
          index={index}
          total={questions.length}
          draft={draftFor(question)}
          answer={answerFor(question, index)}
          locked={settled}
          onToggle={(label) => toggle(question, label)}
          onText={(value) => setText(question, value)}
        />
      ))}
      {interactions}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          disabled={settled}
          onClick={() => onRespond({ cancelled: true })}
          className="cursor-pointer rounded-md border border-ink/15 px-3 py-1 text-[11.5px] font-medium text-ink/70 transition-colors hover:border-ink/30 hover:text-ink disabled:cursor-default disabled:opacity-40"
        >
          Dismiss
        </button>
        <button
          type="button"
          disabled={!anyAnswer || settled}
          onClick={() => onRespond({ answers })}
          className="flex cursor-pointer items-center gap-1.5 rounded-md bg-ink px-3 py-1 text-[11.5px] font-semibold text-paper transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          <CornerDownLeft size={11} />
          <span>Submit answers</span>
        </button>
      </div>
    </div>
  );
}
