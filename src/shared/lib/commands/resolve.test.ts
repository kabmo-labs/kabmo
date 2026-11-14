/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';
import { parseChord } from '@/shared/lib/commands/chord';
import { resolveKey } from '@/shared/lib/commands/resolve';
import type { KeybindingRule } from '@/shared/lib/commands/types';

const rule = (command: string, chord: string, when?: string, source: KeybindingRule['source'] = 'default'): KeybindingRule => ({
  command,
  chord: parseChord(chord),
  ...(when ? { when } : {}),
  source,
});

describe('key resolution', () => {
  test('an exact match runs', () => {
    const result = resolveKey([rule('a', 'cmd+b')], parseChord('cmd+b')[0], {}, null);
    expect(result).toEqual({ kind: 'run', rule: rule('a', 'cmd+b') });
  });

  test('a false when clause is skipped', () => {
    const result = resolveKey([rule('a', 'cmd+b', 'editorTextFocus')], parseChord('cmd+b')[0], {}, null);
    expect(result.kind).toBe('none');
  });

  test('the last matching rule wins, which is how a user override wins', () => {
    const rules = [rule('a', 'cmd+b'), rule('b', 'cmd+b', undefined, 'user')];
    const result = resolveKey(rules, parseChord('cmd+b')[0], {}, null);
    expect(result.kind === 'run' && result.rule.command).toBe('b');
  });

  test('a prefix enters the pending state instead of running', () => {
    const result = resolveKey([rule('a', 'cmd+k cmd+s')], parseChord('cmd+k')[0], {}, null);
    expect(result).toEqual({ kind: 'pending', prefix: parseChord('cmd+k') });
  });

  test('the second stroke completes a pending chord', () => {
    const result = resolveKey(
      [rule('a', 'cmd+k cmd+s')],
      parseChord('cmd+s')[0],
      {},
      parseChord('cmd+k'),
    );
    expect(result.kind === 'run' && result.rule.command).toBe('a');
  });

  test('a stroke that matches nothing clears the pending state', () => {
    const result = resolveKey([rule('a', 'cmd+k cmd+s')], parseChord('cmd+x')[0], {}, parseChord('cmd+k'));
    expect(result.kind).toBe('none');
  });
});
