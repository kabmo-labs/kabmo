/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The effective keymap: built-in defaults, plugin defaults, then user
 * overrides.
 *
 * The order IS the priority model. A user override removes every default for
 * its command and is appended last, so it wins without a numeric rank — the
 * same outcome as VS Code appending `keybindings.json` beneath the defaults.
 *
 * A user override keeps the command's own `when` clause. Binding `⌘B` to
 * "Toggle Sidebar" must not make it fire while the editor has focus, which is
 * exactly what dropping the clause would do.
 */

import { BUILTIN_COMMANDS } from '@/shared/lib/commands/catalog';
import { parseChord } from '@/shared/lib/commands/chord';
import type { CommandMeta, KeybindingRule, UserKeybindings } from '@/shared/lib/commands/types';
import { isMacPlatform, isWindowsPlatform } from '@/shared/lib/util/platform';

interface KeymapState {
  pluginCommands: readonly CommandMeta[];
  user: UserKeybindings;
  listeners: Set<() => void>;
}

declare global {
  // eslint-disable-next-line no-var
  var __kabmoKeymap: KeymapState | undefined;
}

function state(): KeymapState {
  return (globalThis.__kabmoKeymap ??= { pluginCommands: [], user: {}, listeners: new Set() });
}

function publish(): void {
  cachedRules = null;
  for (const listener of [...state().listeners]) listener();
}

/**
 * The resolved rules, rebuilt only when a store changes.
 *
 * The dispatcher asks on every keystroke; rebuilding the array and re-parsing
 * every user chord there would be an allocation per key for an answer that
 * changes only when a command or an override does.
 */
let cachedRules: KeybindingRule[] | null = null;

/** Replace the plugin-contributed commands. The bridge recomputes the whole
 *  list on every slot change, so a replace is the honest operation. */
export function setPluginCommands(commands: readonly CommandMeta[]): void {
  state().pluginCommands = commands;
  publish();
}

export function setUserKeybindings(next: UserKeybindings): void {
  // A chord that does not parse is dropped rather than stored: storing it would
  // remove the command's default and leave it unbound, which is a worse answer
  // than the default the user never changed.
  const valid: Record<string, string | null> = {};
  for (const [id, value] of Object.entries(next)) {
    if (value === null) {
      valid[id] = null;
      continue;
    }
    try {
      parseChord(value);
      valid[id] = value;
    } catch {
      // dropped
    }
  }
  state().user = valid;
  publish();
}

export function userKeybindings(): UserKeybindings {
  return state().user;
}

export function subscribeKeymap(listener: () => void): () => void {
  state().listeners.add(listener);
  return () => state().listeners.delete(listener);
}

/** Every command this build knows: built-ins first, then plugins. */
export function allCommands(): readonly CommandMeta[] {
  return [...BUILTIN_COMMANDS, ...state().pluginCommands];
}

export function commandById(id: string): CommandMeta | undefined {
  return allCommands().find((command) => command.id === id);
}

/** The chord a command's default names on this platform. */
export function platformChord(meta: CommandMeta): KeybindingRule['chord'] | null {
  const key = meta.defaultKey;
  if (!key) return null;
  if (isMacPlatform()) return key.mac;
  if (key.windows && isWindowsPlatform()) return key.windows;
  return key.other;
}

/** The rules the dispatcher and every chord label read. */
export function effectiveRules(): KeybindingRule[] {
  if (cachedRules) return cachedRules;
  const commands = allCommands();
  const rules: KeybindingRule[] = [];
  for (const meta of commands) {
    const chord = platformChord(meta);
    if (!chord) continue;
    rules.push({
      command: meta.id,
      chord,
      ...(meta.when ? { when: meta.when } : {}),
      source: meta.source === 'plugin' ? 'plugin' : 'default',
    });
  }

  const byId = new Map(commands.map((command) => [command.id, command]));
  for (const [id, value] of Object.entries(state().user)) {
    // An id this build no longer ships is KEPT in storage (a downgrade must not
    // lose it) but never applied: a stale override on `⌘B` would otherwise
    // shadow the live command that now owns that chord.
    if (!byId.has(id)) continue;
    for (let index = rules.length - 1; index >= 0; index -= 1) {
      if (rules[index].command === id) rules.splice(index, 1);
    }
    if (value === null) continue;
    try {
      const when = byId.get(id)?.when;
      rules.push({ command: id, chord: parseChord(value), ...(when ? { when } : {}), source: 'user' });
    } catch {
      // `parseUserKeybindings` already dropped a malformed chord; a value that
      // reaches here came from a caller that skipped validation, and binding it
      // to something else would be worse than leaving the command unbound.
    }
  }
  cachedRules = rules;
  return rules;
}

/** The chord a command currently answers to, for a label or a tooltip. */
export function chordForCommand(id: string): KeybindingRule['chord'] | null {
  const rules = effectiveRules().filter((rule) => rule.command === id);
  return rules.length > 0 ? rules[rules.length - 1].chord : null;
}
