/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Key resolution: one stroke in, one decision out.
 *
 * The rule order is the whole priority model. Rules arrive default → plugin →
 * user, and the LAST exact match wins — the same outcome as VS Code appending
 * `keybindings.json` beneath the defaults, without a numeric priority anyone
 * has to reason about.
 */

import type { Chord, CommandContext, KeybindingRule } from '@/shared/lib/commands/types';
import { chordStartsWith } from '@/shared/lib/commands/chord';
import { evaluateWhen } from '@/shared/lib/commands/when';
import type { KeyStroke } from '@/shared/lib/ui/key-binding';

export type KeyResolution =
  | { kind: 'run'; rule: KeybindingRule }
  | { kind: 'pending'; prefix: Chord }
  | { kind: 'none' };

/**
 * Resolve one stroke.
 *
 * `pending` is the prefix already typed for a two-stroke chord. A prefix that
 * matches nothing clears the pending state rather than swallowing the key.
 */
export function resolveKey(
  rules: readonly KeybindingRule[],
  stroke: KeyStroke,
  context: CommandContext,
  pending: Chord | null,
): KeyResolution {
  const sequence: Chord = pending ? [...pending, stroke] : [stroke];
  const live = rules.filter(
    (rule) => chordStartsWith(rule.chord, sequence) && evaluateWhen(rule.when, context),
  );
  const exact = live.filter((rule) => rule.chord.length === sequence.length);
  if (exact.length > 0) return { kind: 'run', rule: exact[exact.length - 1] };
  if (live.length > 0) return { kind: 'pending', prefix: sequence };
  return { kind: 'none' };
}
