/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The command catalog and the effective keymap, as a reactive read.
 *
 * Both stores publish on change (a plugin registering a command, a user
 * remapping one), and every surface that lists commands — the palette, the
 * settings table, the cheatsheet — needs the same fresh answer. One hook, so
 * the three cannot disagree about what exists.
 */

import { useEffect, useMemo, useState } from 'preact/hooks';
import { formatChord } from '@/shared/lib/commands/chord';
import type { CommandMeta, KeybindingRule, UserKeybindings } from '@/shared/lib/commands/types';
import { isMacPlatform } from '@/shared/lib/util/platform';
import { allCommands, effectiveRules, subscribeKeymap, userKeybindings } from '@/client/lib/commands/keymap';
import { subscribeCommands } from '@/client/lib/commands/registry';

export interface CommandCatalog {
  commands: readonly CommandMeta[];
  rules: KeybindingRule[];
  /** command id → the chord it currently answers to, printed. */
  chords: Map<string, string>;
  /** The user's overrides, so a table can mark a row as custom. */
  overrides: UserKeybindings;
}

export function useCommandCatalog(): CommandCatalog {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const bump = () => setVersion((previous) => previous + 1);
    const offRegistry = subscribeCommands(bump);
    const offKeymap = subscribeKeymap(bump);
    return () => {
      offRegistry();
      offKeymap();
    };
  }, []);

  return useMemo(() => {
    const isMac = isMacPlatform();
    const rules = effectiveRules();
    const chords = new Map<string, string>();
    for (const rule of rules) chords.set(rule.command, formatChord(rule.chord, isMac));
    return { commands: allCommands(), rules, chords, overrides: userKeybindings() };
    // `version` is the subscription's signal; the stores are read fresh here.
  }, [version]);
}
