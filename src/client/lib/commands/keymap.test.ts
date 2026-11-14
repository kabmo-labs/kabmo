/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { parseChord } from '@/shared/lib/commands/chord';
import type { CommandMeta } from '@/shared/lib/commands/types';
import {
  chordForCommand,
  effectiveRules,
  setPluginCommands,
  setUserKeybindings,
} from '@/client/lib/commands/keymap';

afterEach(() => {
  setUserKeybindings({});
  setPluginCommands([]);
});

describe('the effective keymap', () => {
  test('a user override replaces the default and is the last rule', () => {
    setUserKeybindings({ 'workspace.toggleSidebar': 'alt+b' });
    const rules = effectiveRules().filter((rule) => rule.command === 'workspace.toggleSidebar');
    expect(rules).toHaveLength(1);
    expect(rules[0].source).toBe('user');
    expect(rules[0].chord).toEqual(parseChord('alt+b'));
  });

  test('an override keeps the command’s when clause', () => {
    setUserKeybindings({ 'workspace.toggleEditorPanel': 'alt+e' });
    const rule = effectiveRules().find((entry) => entry.command === 'workspace.toggleEditorPanel');
    expect(rule?.when).toBe('editorPanelAvailable');
  });

  test('null unbinds the command', () => {
    setUserKeybindings({ 'workspace.toggleSidebar': null });
    expect(effectiveRules().some((rule) => rule.command === 'workspace.toggleSidebar')).toBe(false);
  });

  test('a plugin command contributes a rule with the plugin source', () => {
    const meta: CommandMeta = {
      id: 'plugin.demo.open',
      title: 'Open Demo',
      category: 'Plugin',
      defaultKey: { mac: parseChord('cmd+1'), other: parseChord('ctrl+1') },
      source: 'plugin',
      pluginId: 'demo',
    };
    setPluginCommands([meta]);
    const rule = effectiveRules().find((entry) => entry.command === meta.id);
    expect(rule?.source).toBe('plugin');
  });

  test('an override for a command this build does not ship is kept but not applied', () => {
    setUserKeybindings({ 'old.command': 'cmd+b' });
    const rules = effectiveRules();
    expect(rules.some((rule) => rule.command === 'old.command')).toBe(false);
    // The live command that owns ⌘B still answers to it.
    expect(rules.some((rule) => rule.command === 'workspace.toggleSidebar')).toBe(true);
  });

  test('chordForCommand answers the chord a label should print', () => {
    setUserKeybindings({ 'workspace.toggleSidebar': 'alt+b' });
    expect(chordForCommand('workspace.toggleSidebar')).toEqual(parseChord('alt+b'));
    expect(chordForCommand('workspace.quickOpen')).not.toBeNull();
  });
});
