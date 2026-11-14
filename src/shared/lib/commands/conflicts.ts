/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Conflict detection: two rules on one chord.
 *
 * A conflict is not always a bug — `⌘B` may mean "bold" in the editor and
 * "toggle sidebar" in the workbench — so the report says whether the two
 * clauses can be true at the same time. `certain` means they can: one has no
 * clause, or both name the same one. The settings page shows both kinds and
 * lets the user decide.
 */

import type { Chord, KeybindingRule } from '@/shared/lib/commands/types';
import { chordKey } from '@/shared/lib/commands/chord';

export interface KeybindingConflict {
  chord: Chord;
  a: KeybindingRule;
  b: KeybindingRule;
  /** True when the two rules can be live at the same moment. */
  certain: boolean;
}

export function findConflicts(rules: readonly KeybindingRule[]): KeybindingConflict[] {
  const groups = new Map<string, KeybindingRule[]>();
  for (const rule of rules) {
    const key = chordKey(rule.chord);
    const group = groups.get(key);
    if (group) group.push(rule);
    else groups.set(key, [rule]);
  }

  const conflicts: KeybindingConflict[] = [];
  for (const group of groups.values()) {
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const a = group[i];
        const b = group[j];
        if (a.command === b.command) continue;
        conflicts.push({
          chord: a.chord,
          a,
          b,
          certain: !a.when || !b.when || a.when === b.when,
        });
      }
    }
  }
  return conflicts;
}
