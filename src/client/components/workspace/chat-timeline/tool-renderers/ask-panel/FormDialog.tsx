/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The whole-form control for omp 19.1.0's `method:"form"` frame.
 *
 * omp gave its RPC host a real `ui.formDialog`, so the `ask` tool no longer
 * walks a form one blocking dialog per control: it sends the form ONCE and
 * parks on one `{ data }` reply. That is the shape this card draws — every
 * question at once, one Submit — and it is also what the earlier per-field
 * walk was reconstructed into (`FormAsk`), so the two look the same.
 *
 * The payload is built by `buildFormData`, which mirrors the validation omp
 * applies to the reply (unknown keys, disabled options, array-vs-string
 * choices). Since omp 19.2.0 the field rules (`required`, `pattern`, `min`/`max`,
 * …) are only flagged, never refused: a partly answered form submits what it
 * holds, so the model can reply instead of the user satisfying a control.
 * Submit stays disabled only for the one rule omp still enforces — an empty
 * `data` object.
 */

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { AlertTriangle, Check, CornerDownLeft, HelpCircle } from 'lucide-preact';
import type { ExtensionUiDialogRequest } from '@kabmo-labs/kabmo-chat/contracts/agent';
import type { AskQuestion } from '@/shared/lib/chat/ask-form/types';
import { buildFormData, type FormPick } from '@/shared/lib/chat/ask-form/data';
import { isOtherOption } from '@/shared/lib/chat/ask-questions';
import { AnswerList, QuestionCard } from '@/client/components/workspace/chat-timeline/tool-renderers/ask-panel/QuestionCard';
import { OptionRow } from '@/client/components/workspace/chat-timeline/tool-renderers/ask-panel/OptionRow';
import { partsFor } from '@/client/components/workspace/chat-timeline/tool-renderers/ask-panel/form-picks';
import type { ExtensionDialogResponse } from '@/client/components/workspace/chat-timeline/tool-renderers/extension-dialog/Lazy';

interface FormDialogProps {
  /** The live `method:"form"` frame. */
  frame: ExtensionUiDialogRequest;
  questions: AskQuestion[];
  /** Answers omp already recorded, per question — those render settled. */
  recorded: (readonly string[] | null)[];
  /** What this client just sent, held until omp echoes it in the tool result. */
  submitted?: Record<string, string | string[]> | null;
  onRespond: (response: ExtensionDialogResponse) => void;
  interactions?: ComponentChildren;
}

/** A text control's answer; a `number`/`range` input submits a number. */
function pickFor(picks: Record<number, FormPick>, index: number): FormPick {
  return picks[index] ?? { selected: [], text: '' };
}

export function FormDialog({ frame, questions, recorded, submitted, onRespond, interactions }: FormDialogProps) {
  const [picks, setPicks] = useState<Record<number, FormPick>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const sentRef = useRef(false);

  // A NEW frame is a new form: text and picks left over from the previous one
  // must not read as answers the user just gave.
  useEffect(() => {
    setPicks({});
    setFailure(null);
    setSent(false);
    sentRef.current = false;
  }, [frame.id]);

  // Seeded from the form's own defaults, so a form that opens with a checked
  // radio shows that choice instead of an empty control.
  const seeded = useMemo(() => {
    const initial: Record<number, FormPick> = {};
    questions.forEach((question, index) => {
      const checked = question.options.filter((option) => option.checked).map((option) => option.label);
      const selected = question.multi === true ? checked : checked.slice(0, 1);
      if (selected.length > 0) initial[index] = { selected, text: '' };
    });
    return initial;
  }, [questions]);
  const effective = useMemo(() => ({ ...seeded, ...picks }), [seeded, picks]);

  // `submitted` is optional, so a plain `!== null` reads `undefined` as "already
  // sent" — which disabled every control on a fresh card (measured in the
  // mounted test: the textarea rendered `disabled`).
  const settled = sent || submitted != null;

  const toggle = (index: number, label: string, multi: boolean) => {
    setPicks((current) => {
      const base = current[index] ?? seeded[index] ?? { selected: [], text: '' };
      const selected = multi
        ? (base.selected.includes(label)
            ? base.selected.filter((item) => item !== label)
            : [...base.selected, label])
        : [label];
      return { ...current, [index]: { ...base, selected } };
    });
  };

  const setText = (index: number, text: string) => {
    setPicks((current) => {
      const base = current[index] ?? seeded[index] ?? { selected: [], text: '' };
      return { ...current, [index]: { ...base, text } };
    });
  };

  const built = useMemo(() => buildFormData(questions, effective), [questions, effective]);
  const ready = 'data' in built;

  const submit = () => {
    if (sentRef.current) return;
    const outcome = buildFormData(questions, effective);
    if ('missing' in outcome) {
      setFailure(outcome.missing);
      return;
    }
    sentRef.current = true;
    setSent(true);
    setFailure(null);
    onRespond({ data: outcome.data });
  };

  return (
    <div className="space-y-2">
      {questions.map((question, index) => {
        const recordedParts = recorded[index] ?? null;
        const pick = pickFor(effective, index);
        const sentData = submitted?.[question.id ?? ''];
        const parts = recordedParts
          ? [...recordedParts]
          : submitted && sentData !== undefined
            ? partsFor(question, pick, null)
            : [];
        const answered = recordedParts !== null || (submitted !== null && sentData !== undefined);
        return (
          <QuestionCard
            key={question.id ?? index}
            index={index}
            total={questions.length}
            header={question.header}
            question={question.question}
            multi={question.multi === true}
            answered={answered}
          >
            {answered ? (
              <AnswerList parts={parts} />
            ) : question.kind === 'text' ? (
              <textarea
                rows={3}
                value={pick.text}
                disabled={settled}
                placeholder="Type your answer…"
                aria-label={`Your answer for question ${index + 1}`}
                onInput={(event) => setText(index, event.currentTarget.value)}
                className="mt-2 w-full rounded-md border border-ink/15 bg-canvas/40 px-2 py-1 font-mono text-[11.5px] text-ink outline-none focus:border-ink disabled:opacity-50"
              />
            ) : (
              <>
                <div className="mt-2 space-y-1" role={question.multi === true ? 'group' : 'radiogroup'}>
                  {question.options
                    .filter((option) => !isOtherOption(option.label) && option.disabled !== true)
                    .map((option) => (
                      <OptionRow
                        key={option.label}
                        label={option.label}
                        description={option.description}
                        multi={question.multi === true}
                        checked={pick.selected.includes(option.label)}
                        suggested={question.recommended === question.options.indexOf(option)}
                        disabled={settled}
                        onClick={() => toggle(index, option.label, question.multi === true)}
                      />
                    ))}
                </div>
                <input
                  type="text"
                  value={pick.text}
                  disabled={settled}
                  placeholder="Or type your own…"
                  aria-label={`Your own answer for question ${index + 1}`}
                  onInput={(event) => setText(index, event.currentTarget.value)}
                  className="mt-2 w-full rounded-md border border-ink/15 bg-canvas/40 px-2 py-1 text-[11.5px] text-ink outline-none focus:border-ink disabled:opacity-50"
                />
              </>
            )}
          </QuestionCard>
        );
      })}

      {interactions}

      {failure && (
        <div className="flex items-start gap-1.5 text-[10.5px] text-error">
          <AlertTriangle size={11} className="mt-0.5 shrink-0" />
          <span>{failure}</span>
        </div>
      )}

      <div className="flex items-center gap-2">
        {settled ? (
          <span className="flex items-center gap-1.5 text-[10.5px] text-ink/50">
            <HelpCircle size={11} className="shrink-0" />
            <span>Answers sent — the agent is working on them.</span>
          </span>
        ) : (
          <span className="text-[10.5px] text-ink/45">Answer at least one question, then submit once.</span>
        )}
        <div className="ml-auto flex items-center gap-2">
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
            disabled={settled || !ready}
            onClick={submit}
            className="flex cursor-pointer items-center gap-1.5 rounded-md bg-ink px-3 py-1 text-[11.5px] font-semibold text-paper transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {settled ? <Check size={11} /> : <CornerDownLeft size={11} />}
            <span>Submit answers</span>
          </button>
        </div>
      </div>
    </div>
  );
}
