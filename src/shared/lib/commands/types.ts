/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The command model: one vocabulary for the palette, the keymap, the settings
 * table and the cheatsheet.
 *
 * A command is DATA here and an implementation in the client registry. The
 * split is what lets the server-rendered shell, the settings page and a plugin
 * manifest all name the same command without importing a DOM closure.
 */

import type { KeyStroke } from '@/shared/lib/ui/key-binding';

/** A stable command id, namespaced by area: `workspace.toggleSidebar`. */
export type CommandId = string;

/** One or two strokes. A two-stroke chord is VS Code's `ctrl+k ctrl+c`. */
export type Chord = readonly KeyStroke[];

export type CommandCategory = 'Workspace' | 'View' | 'Navigation' | 'Editor' | 'Session' | 'Plugin';

/** The per-platform default chord, in the same shape the editor keymap uses. */
export interface DefaultKey {
  mac: Chord;
  other: Chord;
  /** Windows-only override, for the chords VS Code splits from Linux. */
  windows?: Chord;
}

/** Everything a surface needs to LIST a command. */
export interface CommandMeta {
  id: CommandId;
  title: string;
  category: CommandCategory;
  /** Extra words the palette matches on, never shown. */
  keywords?: readonly string[];
  /** When-clause; absent means always available. */
  when?: string;
  defaultKey?: DefaultKey;
  source?: 'builtin' | 'plugin';
  /** The plugin that contributed it, for the settings table's provenance line. */
  pluginId?: string;
}

/** One resolved binding. `source` decides who wins when two rules share a chord. */
export interface KeybindingRule {
  command: CommandId;
  chord: Chord;
  when?: string;
  source: 'default' | 'plugin' | 'user';
}

/** The context a `when` clause is evaluated against. */
export type CommandContext = Readonly<Record<string, boolean | string | number | undefined>>;

/** A user override: a chord, or `null` for "deliberately unbound". */
export type UserKeybindings = Readonly<Record<CommandId, string | null>>;
