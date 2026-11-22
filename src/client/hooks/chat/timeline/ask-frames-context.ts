/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The context the timeline provides so any ask card can reach the dialogs omp
 * is blocked on: what `splitAskFrames` routed to it, and the one responder that
 * puts an answer on the wire.
 *
 * Split from `ask-frames.ts` (which owns the ROUTING) because the two answer
 * different questions: routing decides which card a frame belongs to, and this
 * is the plumbing that hands the result down the tree. A component needs one or
 * the other, never both.
 */

import { createContext, useContext } from 'preact/compat';
import type { ExtensionUiDialogRequest } from '@/shared/types/omp/agent';
import type { ExtensionDialogResponse } from '@/client/components/workspace/chat-timeline/tool-renderers/extension-dialog/Lazy';

export interface AskFramesSplit {
  /** The ask's dialogs, bucketed per question, keyed by ask tool-call id. */
  framesByTool: Map<string, ExtensionUiDialogRequest[][]>;
  /**
   * Field dialogs that belong to an open ask but matched no question, keyed by
   * tool id. A form parser can drift from omp's on a shape neither was written
   * for; the frame must still be answerable on the card, and the modal has no
   * field body. The card draws these last, as the live control.
   */
  looseByTool: Map<string, ExtensionUiDialogRequest[]>;
  /** Ask dialogs no card can own — the timeline draws them inline. */
  orphanAsks: ExtensionUiDialogRequest[];
  /**
   * The whole-form dialog of an ask call (omp 19.1.0's `method:"form"`), keyed
   * by tool id. ONE frame answers every control, so it is not bucketed per
   * question like the per-field walk's dialogs.
   */
  formByTool: Map<string, ExtensionUiDialogRequest>;
  /** Oldest non-ask request nothing claimed — the one the modal renders. */
  modalRequest: ExtensionUiDialogRequest | null;
}

export interface AskFramesHandle {
  framesByTool: AskFramesSplit['framesByTool'];
  /** Ask field dialogs a card owns but no question matched (see `looseByTool`). */
  looseByTool: AskFramesSplit['looseByTool'];
  /** Ask dialogs with no tool card to render them (see `orphanAsks`). */
  orphanAsks: AskFramesSplit['orphanAsks'];
  /** The ask's whole-form dialog, when it has one (see `formByTool`). */
  formByTool: AskFramesSplit['formByTool'];
  /** Answer one ask dialog and drop it from the pending queue. */
  respond: (request: ExtensionUiDialogRequest, response: ExtensionDialogResponse) => void;
}

const EMPTY: AskFramesHandle = {
  framesByTool: new Map(),
  looseByTool: new Map(),
  orphanAsks: [],
  formByTool: new Map(),
  respond: () => {},
};

export const AskFramesContext = createContext<AskFramesHandle>(EMPTY);

/** Pending ask dialogs for the timeline that provides them. */
export function useAskFrames(): AskFramesHandle {
  return useContext(AskFramesContext);
}
