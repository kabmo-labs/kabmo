/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The `pendingInteraction` list slot's host: the plugin controls that may answer
 * the agent's own question.
 *
 * This is the one slot where a plugin changes what the agent DOES rather than
 * what it looks like, so the two rules that keep it safe are structural rather
 * than advisory:
 *
 * - **An empty slot renders NOTHING.** A Kabmo with no plugins produces the
 *   card it produced before this slot existed, which is what lets a plugin
 *   DECLINE for free: there is no "waiting for a plugin" state to fall out of,
 *   so a question can never be swallowed by an absent answer.
 * - **A plugin that throws is caught around THAT plugin alone.** The boundary is
 *   a sibling of the human's controls, never an ancestor of them, so a broken
 *   plugin cannot take the question off screen — an agent blocked on a dialog
 *   with nothing left to answer it is the worst failure in this file.
 *
 * `submit`/`cancel` invent no response of their own: they build the exact
 * `ExtensionDialogResponse` the human's own click builds — the grouped card's
 * `{ answers }`, a single dialog's `{ value }`, the Dismiss button's
 * `{ cancelled: true }` — and hand it to the same `onRespond`. omp cannot tell a
 * plugin's answer from a user's, which is the whole point of the slot.
 */

import { Component, type ComponentChildren } from 'preact';
import { useMemo } from 'preact/hooks';
import { AlertTriangle } from 'lucide-preact';
import type { PendingInteractionQuestion, PendingInteractionRegistration } from '@kabmo-labs/kabmo-sdk';
import { PluginIdProvider } from '@kabmo-labs/kabmo-ui';
import type { ExtensionUiDialogRequest } from '@/shared/types/omp/agent';
import { useListSlotRows } from '@/client/hooks/workspace/list-slots';
import type { ExtensionDialogResponse } from '@/client/components/workspace/chat-timeline/tool-renderers/extension-dialog/Lazy';

/** One answer a plugin sends, as the slot's props spell it. */
type PendingAnswer = { id: string; selectedOptions: readonly string[]; customInput?: string };

interface PluginPendingInteractionsProps {
  /** The dialog omp is blocked on — the one a plugin's answer resolves. */
  frame: ExtensionUiDialogRequest;
  /** Answers omp already recorded, aligned with the frame's questions. */
  recorded: readonly boolean[];
  /** The human's own answer path; a plugin's response goes through it unchanged. */
  onRespond: (response: ExtensionDialogResponse) => void;
}

/**
 * The questions the frame is asking, as the slot's props spell them.
 *
 * A GROUPED frame carries them outright. The per-question fallback (omp loops
 * one blocking dialog at a time when the grouped mode is unavailable) carries
 * only the dialog, so the DIALOG is the question: its options are omp's own
 * labels — the strings it compares an answer against — and its frame id is the
 * only stable key the host has for it.
 */
function pendingQuestions(frame: ExtensionUiDialogRequest): PendingInteractionQuestion[] {
  const grouped = frame.questions;
  if (grouped && grouped.length > 0) {
    return grouped.map((question) => ({
      id: question.id,
      question: question.question,
      options: question.options.map((option) => ({ label: option.label, description: option.description })),
      header: question.header,
      multi: question.multi,
      recommended: question.recommended,
    }));
  }

  const details = frame.optionDetails ?? [];
  return [
    {
      id: frame.id,
      question: frame.title || frame.message || '',
      options: (frame.options ?? []).map((label, index) => ({
        label,
        description: details[index]?.description,
      })),
    },
  ];
}

/**
 * The response a plugin's `submit` sends — the same one the human's click sends.
 *
 * A grouped ask is answered by ONE `{ answers }` frame (one entry per question,
 * in order, `customInput` only when there is text), which is what the card's
 * Submit button builds. A single dialog is answered by `{ value }`: the label a
 * user would have clicked, or the text they would have typed — and a typed
 * answer wins over a picked label, exactly as the "Other (type your own)" row
 * behaves for a human.
 */
function submitResponse(frame: ExtensionUiDialogRequest, answers: readonly PendingAnswer[]): ExtensionDialogResponse {
  if (frame.method === 'ask') {
    return {
      answers: answers.map((answer) => ({
        id: answer.id,
        selectedOptions: [...answer.selectedOptions],
        ...(answer.customInput?.trim() ? { customInput: answer.customInput.trim() } : {}),
      })),
    };
  }

  const answer = answers[0];
  const text = answer?.customInput?.trim();
  return { value: text || answer?.selectedOptions[0] || '' };
}

interface PluginRenderBoundaryProps {
  pluginId: string;
  children?: ComponentChildren;
}

interface PluginRenderBoundaryState {
  reason: string | null;
}

/**
 * Holds one plugin's render, so a component that throws takes itself off screen
 * and nothing else.
 *
 * The failure is reported twice over — on the console for whoever is debugging,
 * and in the card for the user who is now looking at a question no plugin is
 * helping with — so a plugin cannot fail invisibly.
 */
class PluginRenderBoundary extends Component<PluginRenderBoundaryProps, PluginRenderBoundaryState> {
  state: PluginRenderBoundaryState = { reason: null };

  static getDerivedStateFromError(error: unknown): PluginRenderBoundaryState {
    return { reason: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown): void {
    console.error(`[plugin:${this.props.pluginId}] pendingInteraction failed to render`, error);
  }

  render(): ComponentChildren {
    const { reason } = this.state;
    if (reason === null) return this.props.children;
    return (
      <div
        data-plugin-error={this.props.pluginId}
        className="flex items-start gap-2 rounded-md border border-error/20 bg-error/[0.03] px-2.5 py-1.5 text-[10.5px] text-ink/70"
      >
        <AlertTriangle size={11} className="mt-0.5 shrink-0 text-error" />
        <span className="select-text">
          Plugin <span className="font-mono">{this.props.pluginId}</span> failed to render its answer control:{' '}
          <span className="font-mono">{reason}</span>
        </span>
      </div>
    );
  }
}

/** Every registered plugin control that may answer the dialog in flight. */
export function PluginPendingInteractions({ frame, recorded, onRespond }: PluginPendingInteractionsProps) {
  const rows = useListSlotRows<PendingInteractionRegistration>('pendingInteraction');
  const questions = useMemo(() => pendingQuestions(frame), [frame]);
  if (rows.length === 0) return null;

  return (
    <>
      {rows.map((entry) => {
        const Component = entry.registration.component;
        return (
          <PluginIdProvider key={`${entry.pluginId}:${entry.registration.id}`} pluginId={entry.pluginId}>
            <PluginRenderBoundary pluginId={entry.pluginId}>
              <Component
                questions={questions}
                recorded={recorded}
                // The response depends on the FRAME, never on which plugin
                // answered, so two plugins answering one dialog send the same
                // frame omp already understands.
                submit={(answers) => onRespond(submitResponse(frame, answers))}
                cancel={() => onRespond({ cancelled: true })}
              />
            </PluginRenderBoundary>
          </PluginIdProvider>
        );
      })}
    </>
  );
}
