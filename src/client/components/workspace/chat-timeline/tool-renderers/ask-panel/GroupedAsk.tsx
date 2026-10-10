/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The GROUPED `ask` control: every question of one `ask` tool call in a single
 * card, answered by ONE `answers` response.
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
 * The option labels are omp's own (they are what it compares a response
 * against), and a question's answer is its option labels plus optional free
 * text — `{ id, selectedOptions, customInput }`, one entry per question, in the
 * order the request listed them.
 */

import { useMemo, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { Check, CornerDownLeft } from 'lucide-preact';
import type { ExtensionAskQuestion, ExtensionUiDialogRequest } from '@/shared/types/omp/agent';
import { MarkdownRenderer } from '@/client/components/common/MarkdownRenderer';
import type { ExtensionDialogResponse } from '@/client/components/workspace/chat-timeline/tool-renderers/extension-dialog/Lazy';

interface GroupedAskProps {
  frame: ExtensionUiDialogRequest;
  /** Answers omp already recorded, per question — those rows render settled. */
  recorded: boolean[];
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

/** One question's controls, plus the shared submit row. */
function QuestionRow({
  question,
  index,
  total,
  draft,
  answered,
  onToggle,
  onText,
}: {
  question: ExtensionAskQuestion;
  index: number;
  total: number;
  draft: Draft;
  answered: boolean;
  onToggle: (label: string) => void;
  onText: (value: string) => void;
}) {
  return (
    <div className="rounded-lg border border-ink/10 bg-paper p-2.5 shadow-xs">
      <div className="flex items-center gap-1.5">
        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-ink/5 font-mono text-[9px] font-semibold text-ink/60">
          {index + 1}
        </span>
        <span className="text-[9px] font-semibold uppercase tracking-wider text-ink/40">
          {question.header ?? `Question ${index + 1}`}
        </span>
        {question.multi && (
          <span className="rounded-full bg-ink/5 px-1.5 py-px font-mono text-[8.5px] text-ink/45">multi</span>
        )}
        {answered && (
          <span className="rounded-full bg-success/10 px-1.5 py-px font-mono text-[8.5px] text-success">answered</span>
        )}
        {total > 1 && (
          <span className="ml-auto font-mono text-[9px] text-ink/35">{index + 1}/{total}</span>
        )}
      </div>

      <div className="mt-1 text-[12.5px] leading-relaxed text-ink/90 select-text">
        <MarkdownRenderer content={question.question} />
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {question.options.map((option, optionIndex) => {
          const chosen = draft.selected.includes(option.label);
          return (
            <button
              key={option.label}
              type="button"
              disabled={answered}
              title={option.description}
              onClick={() => onToggle(option.label)}
              className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11.5px] transition-colors disabled:cursor-default ${
                chosen
                  ? 'border-ink bg-ink text-paper'
                  : 'border-ink/15 text-ink/75 hover:border-ink/35 hover:text-ink'
              }`}
            >
              {chosen && <Check size={11} />}
              <span>{option.label}</span>
              {question.recommended === optionIndex && (
                <span className={`font-mono text-[9px] ${chosen ? 'text-paper/70' : 'text-ink/40'}`}>rec</span>
              )}
            </button>
          );
        })}
      </div>

      <input
        type="text"
        value={draft.text}
        disabled={answered}
        placeholder="Or type your own…"
        aria-label={`Your own answer for question ${index + 1}`}
        onInput={(event) => onText(event.currentTarget.value)}
        className="mt-2 w-full rounded-md border border-ink/15 bg-canvas/40 px-2 py-1 text-[11.5px] text-ink outline-none focus:border-ink disabled:opacity-50"
      />
    </div>
  );
}

export function GroupedAsk({ frame, recorded, onRespond, interactions }: GroupedAskProps) {
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

  return (
    <div className="space-y-2">
      {questions.map((question, index) => (
        <QuestionRow
          key={question.id}
          question={question}
          index={index}
          total={questions.length}
          draft={draftFor(question)}
          answered={recorded[index] === true}
          onToggle={(label) => toggle(question, label)}
          onText={(value) => setText(question, value)}
        />
      ))}
      {interactions}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => onRespond({ cancelled: true })}
          className="cursor-pointer rounded-md border border-ink/15 px-3 py-1 text-[11.5px] font-medium text-ink/70 transition-colors hover:border-ink/30 hover:text-ink"
        >
          Dismiss
        </button>
        <button
          type="button"
          disabled={!anyAnswer}
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
