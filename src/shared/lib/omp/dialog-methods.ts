/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `extension_ui_request` methods that BLOCK the agent until the matching
 * `extension_ui_response` arrives.
 *
 * ONE list, because both halves of the bridge need the same answer and each
 * half had written its own copy: the server's `PendingUiDialogs` (what a
 * reattaching client is offered, what `isBusy`/`refuseWhenBlockedOnDialog`
 * read) and the client's dialog queue. The two copies had drifted — neither
 * carried `'ask'` — so omp's grouped ask frame (the shape `configureChild`
 * opts into with `set_ask_dialog`) was dropped by BOTH: the server forgot the
 * request, and the client never enqueued it. The card then had no dialog to
 * render, so every question fell through to "Waiting for the previous answer…"
 * with nothing to answer — while omp sat blocked on it.
 *
 * `cancel`, `notify`, `open_url`, `setWidget`, `setStatus`, ... are
 * fire-and-forget and must never be listed here: remembering one would offer a
 * later client a modal nothing is waiting on.
 *
 * `'ask'` belongs here because omp's `ask` tool awaits the rich dialog when the
 * host opts in (`set_ask_dialog`), and the per-question `select` loop it falls
 * back to otherwise — both park the tool call until an answer arrives.
 */

import type { ExtensionUiDialogMethod, ExtensionUiDialogRequest } from '@/shared/types/omp/agent';

export const ANSWERABLE_UI_METHODS: Record<string, true> = {
  select: true,
  confirm: true,
  input: true,
  editor: true,
  ask: true,
};

/** True for a request method the agent is parked on. */
export function isAnswerableUiMethod(method: unknown): method is ExtensionUiDialogMethod {
  return typeof method === 'string' && ANSWERABLE_UI_METHODS[method] === true;
}

/**
 * The request-level form of the same test, narrowing omp's union to the dialog
 * variant so a caller can hand it straight to the queue.
 *
 * Narrowing on `request.method` alone does not exclude the `cancel` variant for
 * a caller holding `IncomingExtensionUiRequest` (its members are inline object
 * types, not a discriminated union TS will follow through a property guard), so
 * the exclusion is done here, once, for both the server and the client.
 */
export function isAnswerableUiRequest(
  request: { method?: unknown },
): request is ExtensionUiDialogRequest {
  return isAnswerableUiMethod(request.method);
}
