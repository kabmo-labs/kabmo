/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Inline card for omp's `ask` tool — the whole conversation with the user, in
 * the timeline instead of a modal.
 *
 * omp asks one question per dialog and blocks on it, so a modal could only ever
 * show the question in flight and lost every earlier one on the way; the card
 * keeps all of them in view, marks the ones already answered, and ends as the
 * summary of what the agent asked and what it was told.
 */

import { HelpCircle, XCircle } from 'lucide-preact';
import type { ToolCallData } from '@/shared/types';
import type { ExtensionUiDialogRequest } from '@/shared/types/omp/agent';
import { isAskSettled, parseAskQuestions, parseAskResult } from '@/shared/lib/chat/ask-questions';
import { useAskFrames } from '@/client/hooks/chat/timeline/ask-frames';
import { liveFrame, useAskDrafts } from '@/client/components/workspace/chat-timeline/tool-renderers/ask-panel/drafts';
import { QuestionBlock } from '@/client/components/workspace/chat-timeline/tool-renderers/ask-panel/QuestionBlock';
import { GroupedAsk } from '@/client/components/workspace/chat-timeline/tool-renderers/ask-panel/GroupedAsk';
import { PluginPendingInteractions } from '@/client/components/workspace/chat-timeline/tool-renderers/ask-panel/PluginPendingInteractions';
import type { ExtensionDialogResponse } from '@/client/components/workspace/chat-timeline/tool-renderers/extension-dialog/Lazy';
import { FallbackOutput } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/FallbackOutput';

// Stable empties: fresh `[]` literals would defeat the question block's props.
const NO_FRAMES: ExtensionUiDialogRequest[] = [];
const NO_GROUPS: ExtensionUiDialogRequest[][] = [];
const NO_LABELS: string[] = [];

export function AskPanel({ tool }: { tool: ToolCallData }) {
  const questions = parseAskQuestions(tool);
  const recorded = parseAskResult(tool, questions);
  const { framesByTool, respond } = useAskFrames();
  const groups = framesByTool.get(tool.id) ?? NO_GROUPS;
  const { drafts, multiSelected, commit, toggleMulti } = useAskDrafts({
    toolId: tool.id,
    questions,
    groups,
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
  const settled = isAskSettled(tool);
  const waiting = !settled && groups.some((frames, index) => frames.length > 0 && !recorded[index]);
  // omp asks in order and blocks on each, so the earliest question holding a
  // dialog is the only open one: everything before it is answered, whether or
  // not this client still has the text.
  const askingIndex = groups.findIndex((frames) => frames.length > 0);

  // A GROUPED ask (`method:"ask"`) covers every question at once, so it renders
  // its own card instead of one control per question. `splitAskFrames` places
  // the same frame on each question it names, so the first bucket that holds it
  // is where it renders — exactly once.
  const groupedFrame = groups.flat().find((frame) => frame.method === 'ask' && (frame.questions?.length ?? 0) > 0);
  if (groupedFrame && !settled) {
    // The recorded flags and the answer path are shared with the plugin slot:
    // a plugin's response must be the frame the Submit button would have sent,
    // through the same sender, or omp receives something it did not expect.
    const answered = questions.map((_, index) => recorded[index] !== null);
    const answer = (response: ExtensionDialogResponse) => respond(groupedFrame, response);
    return (
      <div className="space-y-2">
        {waiting && (
          <div className="flex items-center gap-1.5 text-[10.5px] text-ink/50">
            <HelpCircle size={11} className="shrink-0" />
            <span>Input needed — the agent is blocked until you answer.</span>
          </div>
        )}
        <GroupedAsk
          frame={groupedFrame}
          recorded={answered}
          onRespond={answer}
          interactions={
            <PluginPendingInteractions frame={groupedFrame} recorded={answered} onRespond={answer} />
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
          <span>Input needed — the agent is blocked until you answer.</span>
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

      {(tool.status === 'error' || tool.status === 'aborted') && tool.output && (
        <div className="flex items-start gap-2 rounded-md border border-ink/8 bg-ink/[0.02] px-2.5 py-1.5 text-[10.5px] text-ink/60">
          <XCircle size={11} className="mt-0.5 shrink-0 text-ink/40" />
          <span className="font-mono select-text">{tool.output}</span>
        </div>
      )}
    </div>
  );
}
