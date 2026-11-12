/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Controls Kabmo does not ask about, and the `<label for>` pre-pass that names
 * the ones it does.
 *
 * A `<label for="id">` sits anywhere in the form, so its text cannot be read
 * while walking — the control it names may come first. This collects those
 * pairs up front, keyed by the control's id, and the walk consults the map when
 * a control has no wrapping `<label>`. Split from `ask-form/index.ts` (which
 * owns the walk) to keep that file under the repo's per-file ceiling.
 */

import { matchingClose, textOf, type Token } from '@/shared/lib/chat/ask-form/tokens';

/** Input types that are never a question: chrome, or state the form carries. */
export const IGNORED_INPUTS: Record<string, true> = {
  button: true,
  file: true,
  image: true,
  reset: true,
  submit: true,
  hidden: true,
};

/** Ids of the controls in the token range, and the `<label for>` text naming them. */
export function readLabelTargets(tokens: Token[]): Map<string, string> {
  const ids = new Set<string>();
  for (const token of tokens) {
    if (token.kind !== 'open') continue;
    if (token.tag !== 'input' && token.tag !== 'select' && token.tag !== 'textarea') continue;
    if (token.attrs.id) ids.add(token.attrs.id);
  }
  const labels = new Map<string, string>();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.kind !== 'open' || token.tag !== 'label' || token.selfClosing) continue;
    const target = token.attrs.for;
    if (!target || !ids.has(target) || labels.has(target)) continue;
    labels.set(target, textOf(tokens, index + 1, matchingClose(tokens, index, 'label')));
  }
  return labels;
}
