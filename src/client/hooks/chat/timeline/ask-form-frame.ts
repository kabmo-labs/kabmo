/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which ask call omp 19.1.0's whole-form dialog belongs to.
 *
 * Since 19.1.0 the `ask` tool takes the RPC host's real `formDialog`: it sends
 * the form ONCE as `{method:"form", html}` and parks on one `{data}` reply. The
 * frame carries no `title` and no per-question ids, so neither key the
 * per-field walk uses can place it — the `html` is the only one both sides
 * hold, because it is the exact string the tool call's arguments carry.
 *
 * A child that normalizes its own HTML on the way out leaves the strings
 * unequal while the QUESTION COUNT still identifies the call, and the ask tool
 * is exclusive (nothing else can be asking while it blocks), so a single open
 * ask is unambiguous. Anything else is an ORPHAN: an extension's own
 * `formDialog` has no card, and the timeline draws it inline — the modal has no
 * form body.
 */

import { parseAskForm } from '@/shared/lib/chat/ask-form';
import type { AskCall } from '@/client/hooks/chat/timeline/ask-frame-asks';

/** The owning call, or undefined when no open ask can claim the form. */
export function claimFormFrame(html: string, openAsks: readonly AskCall[]): AskCall | undefined {
  const exact = [...openAsks].reverse().find((candidate) => candidate.html === html);
  if (exact) return exact;
  if (openAsks.length !== 1) return undefined;
  const only = openAsks[0];
  return parseAskForm(html).length === only.questions.length ? only : undefined;
}
