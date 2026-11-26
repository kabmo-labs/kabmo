/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Inline card for omp's `ask` tool — the whole conversation with the user, in
 * the timeline instead of a modal.
 *
 * omp asks one question per dialog and blocks on it, so a modal could only ever
 * show the question in flight and lost every earlier one on the way; the card
 * keeps all of them in view, marks the ones already answered, and ends as the
 * summary of what the agent asked and what it was told.
 *
 * Two shapes reach this card (see `ask-questions.ts`): the grouped frame
 * (`method:"ask"`, one frame for every question) and the per-question `select`
 * loop. The grouped frame is answered by ONE `answers` response, and the card
 * HOLDS that response until omp echoes it back in the tool result: the frame
 * leaves the pending queue the instant the response is on the wire, and omp
 * writes no result until the tool call finishes — so without the hold the card
 * redrew as unanswered (every question back to "Waiting for the previous
 * answer…") for the whole stretch the agent spent acting on the answers.
 */

import { useState } from 'preact/hooks';
import { HelpCircle, XCircle } from 'lucide-preact';
import type { ToolCallData } from '@/shared/types';
import type { ExtensionUiDialogRequest } from '@kabmo-labs/kabmo-chat/contracts/agent';
import { isAskSettled, parseAskQuestions } from '@/shared/lib/chat/ask-questions';
import type { AskQuestion } from '@/shared/lib/chat/ask-form/types';
import { parseAskResult } from '@/shared/lib/chat/ask-results';
import { useAskFrames } from '@/client/hooks/chat/timeline/ask-frames-context';
import { liveFrame, useAskDrafts } from '@/client/components/workspace/chat-timeline/tool-renderers/ask-panel/drafts';
import { QuestionBlock } from '@/client/components/workspace/chat-timeline/tool-renderers/ask-panel/QuestionBlock';
import { GroupedAsk } from '@/client/components/workspace/chat-timeline/tool-renderers/ask-panel/GroupedAsk';
import { FormAsk } from '@/client/components/workspace/chat-timeline/tool-renderers/ask-panel/FormAsk';
import { FormDialog } from '@/client/components/workspace/chat-timeline/tool-renderers/ask-panel/FormDialog';
import { LooseFieldAsk } from '@/client/components/workspace/chat-timeline/tool-renderers/ask-panel/LooseFieldAsk';
import { PluginPendingInteractions } from '@/client/components/workspace/chat-timeline/tool-renderers/ask-panel/PluginPendingInteractions';
import type { ExtensionDialogResponse } from '@/client/components/workspace/chat-timeline/tool-renderers/extension-dialog/Lazy';
import { FallbackOutput } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/FallbackOutput';

// Stable empties: fresh `[]` literals would defeat the question block's props.
const NO_FRAMES: ExtensionUiDialogRequest[] = [];
const NO_GROUPS: ExtensionUiDialogRequest[][] = [];
const NO_LABELS: string[] = [];
const NO_QUESTIONS: AskQuestion[] = [];

/**
 * A grouped ask this client answered, waiting for omp to echo it in the result.
 *
 * The FRAME is held, not only the answers: the pending queue drops it the
 * instant the response is on the wire, so the card would otherwise have no
 * questions to draw for the whole window omp spends acting on the answers.
 */
interface SubmittedAsk {
  frame: ExtensionUiDialogRequest;
  answers: { id: string; selectedOptions: string[]; customInput?: string }[];
}

export function AskPanel({ tool }: { tool: ToolCallData }) {
  const questions = parseAskQuestions(tool);
  const recorded = parseAskResult(tool, questions);
  const { framesByTool, looseByTool, formByTool, respond } = useAskFrames();
  const groups = framesByTool.get(tool.id) ?? NO_GROUPS;
  const loose = looseByTool.get(tool.id) ?? NO_FRAMES;
  const settled = isAskSettled(tool);
  // omp 19.1.0's whole-form dialog answers every control in ONE `{ data }`
  // reply; it is not part of the per-field walk at all.
  const formFrame = formByTool.get(tool.id) ?? null;
  // Two or more open fields are answered by ONE Submit (`FormAsk`). The
  // per-question draft bookkeeper must not run in that mode: it auto-sends a
  // restored draft the moment its frame arrives, which would answer question 1
  // before the user could reach the form's Submit.
  const groupedForm =
    !formFrame && !settled && questions.length > 1 && recorded.some((answer) => answer === null);
  const [submitted, setSubmitted] = useState<SubmittedAsk | null>(null);
  const { drafts, multiSelected, commit, toggleMulti } = useAskDrafts({
    toolId: tool.id,
    questions: groupedForm ? NO_QUESTIONS : questions,
    groups: groupedForm ? NO_GROUPS : groups,
    recorded,
    respond,
  });

  // An `ask` whose arguments the timeline never saw (or a non-questions shape)
  // still has a result worth showing.
  if (questions.length === 0) {
    return tool.output ? <FallbackOutput text={tool.output} /> : null;
  }

  // An ask whose tool call failed or was aborted is OVER: omp cancels the live
  // dialog on abort (the client drops it on that `cancel` frame) and the result
  // records no answer, so after the queue empties every unanswered question
  // falls out of the "passed" branch with nothing left to say it was
  // abandoned — the card read "Waiting for the previous answer…" over a run the
  // user had already stopped. Only a terminal status counts: a session reloaded
  // mid-ask reads its still-blocking tool call back from the JSONL as
  // `success` (omp writes no result until the question is answered), and that
  // question must stay answerable.
  const waiting =
    !settled &&
    (formFrame !== null || groups.some((frames, index) => frames.length > 0 && !recorded[index]));
  // omp asks in order and blocks on each, so the earliest question holding a
  // dialog is the only open one: everything before it is answered, whether or
  // not this client still has the text.
  const askingIndex = groups.findIndex((frames) => frames.length > 0);

  // A GROUPED ask (`method:"ask"`) covers every question at once, so it renders
  // its own card instead of one control per question. `splitAskFrames` places
  // the same frame on each question it names, so the first bucket that holds it
  // is where it renders — exactly once.
  const groupedFrame = groups.flat().find((frame) => frame.method === 'ask' && (frame.questions?.length ?? 0) > 0);

  // The grouped card renders while its frame is pending. It is ALSO drawn from
  // the frame this client already answered, for the window between the response
  // leaving here and omp echoing it in the tool result: the pending queue drops
  // the frame the instant it is answered, and without the held copy the card
  // redrew as unanswered (every question back to "Waiting for the previous
  // answer…") while the agent was acting on the answers it had just received.
  const heldFrame = submitted && recorded.every((answer) => answer === null) ? submitted.frame : null;
  const card = groupedFrame ?? heldFrame;

  if (card && !settled) {
    const answered = submitted && submitted.frame.id === card.id ? submitted.answers : null;
    // The recorded flags and the answer path are shared with the plugin slot:
    // a plugin's response must be the frame the Submit button would have sent,
    // through the same sender, or omp receives something it did not expect.
    const answer = (response: ExtensionDialogResponse) => {
      if ('answers' in response) setSubmitted({ frame: card, answers: response.answers });
      respond(card, response);
    };
    return (
      <div className="space-y-2">
        {waiting && (
          <div className="flex items-center gap-1.5 text-[10.5px] text-ink/50">
            <HelpCircle size={11} className="shrink-0" />
            <span>Input needed: the agent is blocked until you answer.</span>
          </div>
        )}
        <GroupedAsk
          frame={card}
          recorded={recorded}
          submitted={answered}
          onRespond={answer}
          interactions={
            <PluginPendingInteractions
              frame={card}
              recorded={questions.map((_, index) => recorded[index] !== null)}
              onRespond={answer}
            />
          }
        />
      </div>
    );
  }

  // omp 19.1.0's `method:"form"` frame: ONE dialog for the whole form, answered
  // by one `{ data }` reply. It carries no per-question dialogs, so it is drawn
  // before the per-field branches — those have nothing to show here.
  if (formFrame) {
    return (
      <div className="space-y-2">
        {waiting && (
          <div className="flex items-center gap-1.5 text-[10.5px] text-ink/50">
            <HelpCircle size={11} className="shrink-0" />
            <span>Input needed: the agent is blocked until you answer.</span>
          </div>
        )}
        <FormDialog
          frame={formFrame}
          questions={questions}
          recorded={recorded.map((answer) => (answer ? [...answer.selectedOptions, ...(answer.customInput ? [answer.customInput] : [])] : null))}
          onRespond={(response) => respond(formFrame, response)}
          interactions={
            <PluginPendingInteractions
              frame={formFrame}
              recorded={questions.map((_, index) => recorded[index] !== null)}
              onRespond={(response) => respond(formFrame, response)}
            />
          }
        />
      </div>
    );
  }

  // Two or more fields from the per-field walk: draw the WHOLE form and take a
  // single Submit. The old card answered one question per round trip, so the
  // second question appeared only after the first had gone to omp — and a
  // field whose derived title drifted was handed to the modal. The submit here
  // is what `FormAsk` replays into omp's one-dialog-per-field wire.
  if (groupedForm) {
    const live = groups.map((frames) => (frames.length > 0 ? frames[frames.length - 1] : null)).find(Boolean) ?? loose[0] ?? null;
    return (
      <div className="space-y-2">
        {waiting && (
          <div className="flex items-center gap-1.5 text-[10.5px] text-ink/50">
            <HelpCircle size={11} className="shrink-0" />
            <span>Input needed: the agent is blocked until you answer.</span>
          </div>
        )}
        <FormAsk
          questions={questions}
          groups={groups}
          recorded={recorded}
          loose={loose}
          onRespond={respond}
          interactions={
            live ? (
              <PluginPendingInteractions
                frame={live}
                recorded={questions.map((_, index) => recorded[index] !== null)}
                onRespond={(response) => respond(live, response)}
              />
            ) : undefined
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {waiting && (
        <div className="flex items-center gap-1.5 text-[10.5px] text-ink/50">
          <HelpCircle size={11} className="shrink-0" />
          <span>Input needed: the agent is blocked until you answer.</span>
        </div>
      )}

      {questions.map((question, index) => {
        const live = liveFrame(groups, index);
        const answer = (response: ExtensionDialogResponse) => {
          if (live) respond(live, response);
        };
        return (
          <QuestionBlock
            key={question.id ?? index}
            index={index}
            total={questions.length}
            question={question}
            frames={groups[index] ?? NO_FRAMES}
            recorded={recorded[index] ?? null}
            draft={drafts[index]}
            passed={askingIndex !== -1 && index < askingIndex}
            settled={settled}
            multiSelected={multiSelected[index] ?? NO_LABELS}
            onAnswer={(value) => commit(index, value)}
            onToggle={(label) => toggleMulti(index, label)}
            onRespond={answer}
            // Rendered by `QuestionBlock` only while its dialog is live, so a
            // question already answered — or one omp has moved past — never
            // shows a plugin control.
            interactions={
              live ? (
                <PluginPendingInteractions
                  frame={live}
                  recorded={[recorded[index] !== null]}
                  onRespond={answer}
                />
              ) : undefined
            }
          />
        );
      })}

      {loose.map((frame) => (
        <LooseFieldAsk key={frame.id} frame={frame} onRespond={respond} />
      ))}

      {(tool.status === 'error' || tool.status === 'aborted') && tool.output && (
        <div className="flex items-start gap-2 rounded-md border border-ink/8 bg-ink/[0.02] px-2.5 py-1.5 text-[10.5px] text-ink/60">
          <XCircle size={11} className="mt-0.5 shrink-0 text-ink/40" />
          <span className="font-mono select-text">{tool.output}</span>
        </div>
      )}
    </div>
  );
}
