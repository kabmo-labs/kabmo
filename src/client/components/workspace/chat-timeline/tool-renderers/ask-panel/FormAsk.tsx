/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The GROUPED control for omp 18.18.3's per-field `ask` walk.
 *
 * That tool takes one HTML form, but the RPC host has no `formDialog` member,
 * so omp walks the form's named controls one blocking dialog at a time — a
 * question the user could only answer by filling the card one field per round
 * trip. This component restores the grouped shape from omp's own
 * `method:"ask"` dialog: every question is drawn and answered on the card, and
 * ONE Submit sends the answers by walking the frames omp raises for them.
 *
 * The submit is a small state machine, because the wire is still per-field:
 * answering the live dialog makes omp ask the next field, so each new frame is
 * answered from the collected picks as it arrives. A multi-select is re-asked
 * once per toggle (`selectionMarker: "checkbox"`), so its labels are sent one
 * per frame and the "Done selecting" row ends it; a typed answer is sent to
 * the `input`/`editor` frame the "Other" row opens.
 *
 * Answer labels are matched against the FRAME's rows, never the parsed
 * question: omp decorates them (` (Recommended)`, `Other (type your own)`,
 * `✓ Done selecting`) and compares a response against those exact strings.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { AlertTriangle, Check, CornerDownLeft, HelpCircle } from 'lucide-preact';
import type { ExtensionUiDialogRequest } from '@/shared/types/omp/agent';
import type { AskAnswer, AskQuestion } from '@/shared/lib/chat/ask-form/types';
import { isOtherOption } from '@/shared/lib/chat/ask-questions';
import { AnswerList, QuestionCard } from '@/client/components/workspace/chat-timeline/tool-renderers/ask-panel/QuestionCard';
import { OptionRow } from '@/client/components/workspace/chat-timeline/tool-renderers/ask-panel/OptionRow';
import { liveFrame } from '@/client/components/workspace/chat-timeline/tool-renderers/ask-panel/drafts';
import { DONE_ROW, optionForLabel, partsFor, type Pick } from '@/client/components/workspace/chat-timeline/tool-renderers/ask-panel/form-picks';
import type { ExtensionDialogResponse } from '@/client/components/workspace/chat-timeline/tool-renderers/extension-dialog/Lazy';

interface FormAskProps {
  questions: AskQuestion[];
  /** Dialogs per question, oldest first — the last one is live. */
  groups: ExtensionUiDialogRequest[][];
  /** Answers omp already recorded; those questions render settled. */
  recorded: (AskAnswer | null)[];
  /** Owned field dialogs whose title and rows both missed. */
  loose: ExtensionUiDialogRequest[];
  onRespond: (request: ExtensionUiDialogRequest, response: ExtensionDialogResponse) => void;
  interactions?: ComponentChildren;
}

type Phase = 'editing' | 'sending' | 'failed';

/** omp rejects a typed answer with the question and a reason; give up after 3. */
const MAX_TEXT_ATTEMPTS = 3;

export function FormAsk({ questions, groups, recorded, loose, onRespond, interactions }: FormAskProps) {
  const [picks, setPicks] = useState<Record<number, Pick>>(() => {
    const initial: Record<number, Pick> = {};
    questions.forEach((question, index) => {
      const checked = question.options.filter((option) => option.checked).map((option) => option.label);
      const selected = question.multi === true ? checked : checked.slice(0, 1);
      if (selected.length > 0) initial[index] = { selected, text: '' };
    });
    return initial;
  });
  const picksRef = useRef(picks);
  picksRef.current = picks;
  const [phase, setPhase] = useState<Phase>('editing');
  const [failure, setFailure] = useState<string | null>(null);
  // Frame ids already answered, so a re-render cannot answer one twice.
  const sentRef = useRef<Set<string>>(new Set());
  // Per-question progress through a multi-select's labels and its Other flow.
  const cursorRef = useRef<Record<number, number>>({});
  const otherRef = useRef<Record<number, boolean>>({});
  const attemptsRef = useRef<Record<number, number>>({});

  const pickFor = (index: number): Pick => picks[index] ?? { selected: [], text: '' };

  const toggle = (index: number, label: string, multi: boolean) => {
    setPicks((current) => {
      const pick = current[index] ?? { selected: [], text: '' };
      const selected = multi
        ? (pick.selected.includes(label)
            ? pick.selected.filter((item) => item !== label)
            : [...pick.selected, label])
        : [label];
      return { ...current, [index]: { ...pick, selected } };
    });
  };

  const setText = (index: number, text: string) => {
    setPicks((current) => ({ ...current, [index]: { ...(current[index] ?? { selected: [] }), text } }));
  };

  const answerFor = (index: number): AskAnswer | null => {
    const recordedAnswer = recorded[index] ?? null;
    if (recordedAnswer) return recordedAnswer;
    // Only the in-flight phase shows the picks as sent; `failed` hands the
    // controls back so the answer that omp rejected can be fixed.
    if (phase !== 'sending') return null;
    const pick = pickFor(index);
    if (pick.selected.length === 0 && !pick.text.trim()) return null;
    return {
      selectedOptions: pick.selected,
      ...(pick.text.trim() ? { customInput: pick.text.trim() } : {}),
    };
  };

  const hasAnswer = (index: number): boolean => {
    if (recorded[index]) return true;
    const pick = pickFor(index);
    return pick.selected.length > 0 || pick.text.trim().length > 0;
  };
  const ready = questions.every((_, index) => hasAnswer(index));

  // The submit: answer the live frame for each question as omp raises it. A
  // frame with no question bucket is used by the first question still waiting
  // when it is the only one left — that is what keeps a drifted title on the
  // card instead of leaving the run parked.
  useEffect(() => {
    if (phase !== 'sending') return;
    const fail = (message: string) => {
      setFailure(message);
      setPhase('failed');
    };
    for (let index = 0; index < questions.length; index += 1) {
      if (recorded[index]) continue;
      const question = questions[index];
      let frame = liveFrame(groups, index);
      if (!frame) {
        const remaining = loose.filter((candidate) => !sentRef.current.has(candidate.id));
        const wanted = question.kind === 'text' ? ['input', 'editor'] : ['select'];
        const only = remaining.filter((candidate) => wanted.includes(candidate.method));
        if (remaining.length === 1 && only.length === 1) frame = only[0];
      }
      if (!frame || sentRef.current.has(frame.id)) continue;
      const pick = picksRef.current[index] ?? { selected: [], text: '' };
      const send = (response: ExtensionDialogResponse) => {
        sentRef.current.add(frame!.id);
        onRespond(frame!, response);
      };

      if (frame.method === 'input' || frame.method === 'editor') {
        const text = pick.text.trim();
        if (!text) return fail(`Question ${index + 1} has no typed answer.`);
        const attempts = attemptsRef.current[index] ?? 0;
        if (attempts >= MAX_TEXT_ATTEMPTS) {
          return fail(`omp rejected the answer to question ${index + 1} ${MAX_TEXT_ATTEMPTS} times. Fix it and submit again.`);
        }
        attemptsRef.current[index] = attempts + 1;
        send({ value: text });
        continue;
      }

      if (frame.method !== 'select') continue;
      const options = frame.options ?? [];

      if (question.multi !== true) {
        const label = optionForLabel(options, pick.selected[0]);
        if (label) {
          send({ value: label });
          continue;
        }
        const other = options.find(isOtherOption);
        if (pick.text.trim() && other) {
          // Picking the row is what opens omp's free-text dialog; the text is
          // sent to the `input` frame that follows.
          if (!otherRef.current[index]) {
            otherRef.current[index] = true;
            send({ value: other });
          }
          continue;
        }
        return fail(`Question ${index + 1} has no choice omp is offering.`);
      }

      // A multi-select starts from whatever the form marked `checked`, so a
      // response is only sent for a row whose state DIFFERS from the frame's
      // own `checkedIndices` — sending a checked row would toggle it OFF.
      const wanted = new Set<string>();
      for (const label of pick.selected) {
        if (isOtherOption(label)) continue;
        const row = optionForLabel(options, label);
        if (!row) return fail(`Question ${index + 1} has no row "${label}".`);
        wanted.add(row);
      }
      if (Array.isArray(frame.checkedIndices)) {
        const on = new Set(frame.checkedIndices.map((row) => options[row]).filter(Boolean));
        const ownRows = new Set(
          question.options
            .filter((option) => !isOtherOption(option.label))
            .map((option) => optionForLabel(options, option.label))
            .filter((row): row is string => Boolean(row)),
        );
        const needOn = [...wanted].filter((row) => ownRows.has(row) && !on.has(row));
        const needOff = [...on].filter((row) => ownRows.has(row) && !wanted.has(row));
        const next = needOn[0] ?? needOff[0];
        if (next) {
          send({ value: next });
          continue;
        }
      } else {
        // Older children send no `checkedIndices`; each label is one toggle and
        // the cursor is all the progress there is.
        const cursor = cursorRef.current[index] ?? 0;
        const rows = [...wanted];
        if (cursor < rows.length) {
          cursorRef.current[index] = cursor + 1;
          send({ value: rows[cursor] });
          continue;
        }
      }
      const other = options.find(isOtherOption);
      if (pick.text.trim() && other && !otherRef.current[index]) {
        otherRef.current[index] = true;
        send({ value: other });
        continue;
      }
      const done = options.find((option) => DONE_ROW.test(option));
      if (!done) return fail(`Question ${index + 1} has no "Done selecting" row.`);
      send({ value: done });
    }
  }, [phase, groups, loose, recorded, questions, onRespond]);

  const submit = () => {
    sentRef.current = new Set();
    cursorRef.current = {};
    otherRef.current = {};
    attemptsRef.current = {};
    setFailure(null);
    setPhase('sending');
  };

  const live = groups.map((frames) => (frames.length > 0 ? frames[frames.length - 1] : null)).find(Boolean) ?? loose[0] ?? null;
  const sending = phase === 'sending';

  return (
    <div className="space-y-2">
      {questions.map((question, index) => {
        const answer = answerFor(index);
        const pick = pickFor(index);
        return (
          <QuestionCard
            key={question.id ?? index}
            index={index}
            total={questions.length}
            header={question.header}
            question={question.question}
            multi={question.multi === true}
            answered={answer !== null}
          >
            {answer !== null ? (
              <AnswerList parts={partsFor(question, pick, recorded[index] ?? null)} />
            ) : (
              <>
                {question.kind === 'text' ? (
                  <textarea
                    rows={3}
                    value={pick.text}
                    disabled={sending}
                    placeholder="Type your answer…"
                    aria-label={`Your answer for question ${index + 1}`}
                    onInput={(event) => setText(index, event.currentTarget.value)}
                    className="mt-2 w-full rounded-md border border-ink/15 bg-canvas/40 px-2 py-1 font-mono text-[11.5px] text-ink outline-none focus:border-ink disabled:opacity-50"
                  />
                ) : (
                  <>
                    <div className="mt-2 space-y-1" role={question.multi === true ? 'group' : 'radiogroup'}>
                      {question.options.filter((option) => !isOtherOption(option.label)).map((option, optionIndex) => (
                        <OptionRow
                          key={option.label}
                          label={option.label}
                          description={option.description}
                          multi={question.multi === true}
                          checked={pick.selected.includes(option.label)}
                          suggested={question.recommended === optionIndex}
                          disabled={sending}
                          onClick={() => toggle(index, option.label, question.multi === true)}
                        />
                      ))}
                    </div>
                    <input
                      type="text"
                      value={pick.text}
                      disabled={sending}
                      placeholder="Or type your own…"
                      aria-label={`Your own answer for question ${index + 1}`}
                      onInput={(event) => setText(index, event.currentTarget.value)}
                      className="mt-2 w-full rounded-md border border-ink/15 bg-canvas/40 px-2 py-1 text-[11.5px] text-ink outline-none focus:border-ink disabled:opacity-50"
                    />
                  </>
                )}
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
        {sending ? (
          <span className="flex items-center gap-1.5 text-[10.5px] text-ink/50">
            <HelpCircle size={11} className="shrink-0" />
            <span>Sending your answers — the agent is blocked until the form completes.</span>
          </span>
        ) : (
          <span className="text-[10.5px] text-ink/45">Answer every question, then submit once.</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            disabled={sending || !live}
            onClick={() => {
              if (live) onRespond(live, { cancelled: true });
            }}
            className="cursor-pointer rounded-md border border-ink/15 px-3 py-1 text-[11.5px] font-medium text-ink/70 transition-colors hover:border-ink/30 hover:text-ink disabled:cursor-default disabled:opacity-40"
          >
            Dismiss
          </button>
          <button
            type="button"
            disabled={sending || !ready}
            onClick={submit}
            className="flex cursor-pointer items-center gap-1.5 rounded-md bg-ink px-3 py-1 text-[11.5px] font-semibold text-paper transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {sending ? <Check size={11} /> : <CornerDownLeft size={11} />}
            <span>Submit answers</span>
          </button>
        </div>
      </div>
    </div>
  );
}
