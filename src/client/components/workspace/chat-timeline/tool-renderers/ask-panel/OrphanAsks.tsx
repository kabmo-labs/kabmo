/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Ask dialogs with no tool card behind them, drawn IN the timeline.
 *
 * An `ask` frame is normally claimed by the tool call that raised it (see
 * `ask-frames.ts`), but three real shapes have no card to claim:
 *
 *  - a subagent's own question — the subagent runs in its own transcript and
 *    its tool call is not in this session's row list;
 *  - an extension's `askDialog` (the ratchet approval is one), which is not an
 *    `ask` tool call at all;
 *  - a tool call outside the loaded history window, or one whose arguments
 *    never arrived.
 *
 * All of them still BLOCK the agent until answered, so they must stay
 * answerable — and the one place they must not be is a modal over the
 * conversation: `ExtensionDialog` has no `ask` body, so an orphaned frame there
 * rendered an empty panel with a single button, and that button sent a bare
 * `{ value }` that omp rejects ("Ask dialog response must carry N answers").
 * The reported symptom was exactly that empty modal.
 *
 * The card is the same `GroupedAsk` the inline tool card uses, so a question
 * reads identically wherever it came from.
 */

import { HelpCircle } from 'lucide-preact';
import type { ExtensionUiDialogRequest } from '@/shared/types/omp/agent';
import { useAskFrames } from '@/client/hooks/chat/timeline/ask-frames';
import { GroupedAsk } from '@/client/components/workspace/chat-timeline/tool-renderers/ask-panel/GroupedAsk';
import type { ExtensionDialogResponse } from '@/client/components/workspace/chat-timeline/tool-renderers/extension-dialog/Lazy';

/** One orphan ask, rendered as a self-contained card at the end of the timeline. */
function OrphanAskCard({ frame, onRespond }: {
  frame: ExtensionUiDialogRequest;
  onRespond: (request: ExtensionUiDialogRequest, response: ExtensionDialogResponse) => void;
}) {
  return (
    <div className="rounded-lg border border-ink/12 bg-paper p-3 shadow-xs">
      <div className="mb-2 flex items-center gap-1.5 text-[10.5px] text-ink/50">
        <HelpCircle size={11} className="shrink-0" />
        <span>Input needed — the agent is blocked until you answer.</span>
      </div>
      <GroupedAsk
        frame={frame}
        recorded={(frame.questions ?? []).map(() => null)}
        onRespond={(response) => onRespond(frame, response)}
      />
    </div>
  );
}

/**
 * Every orphan ask, oldest first. Rendered inside the timeline's scroll body so
 * it behaves like any other row — a question is part of the conversation, and a
 * surface floating above the transcript hid the turn it belongs to.
 */
export function OrphanAsks() {
  const { orphanAsks, respond } = useAskFrames();
  if (orphanAsks.length === 0) return null;
  return (
    <div className="mt-2 space-y-2">
      {orphanAsks.map((frame) => (
        <OrphanAskCard key={frame.id} frame={frame} onRespond={respond} />
      ))}
    </div>
  );
}
