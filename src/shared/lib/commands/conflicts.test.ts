/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';
import { parseChord } from '@/shared/lib/commands/chord';
import { findConflicts } from '@/shared/lib/commands/conflicts';
import type { KeybindingRule } from '@/shared/lib/commands/types';

const rule = (command: string, chord: string, when?: string): KeybindingRule => ({
  command,
  chord: parseChord(chord),
  ...(when ? { when } : {}),
  source: 'default',
});

describe('conflict detection', () => {
  test('two commands on one chord conflict', () => {
    const conflicts = findConflicts([rule('a', 'cmd+b'), rule('b', 'cmd+b')]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].certain).toBe(true);
  });

  test('the same command twice is not a conflict', () => {
    expect(findConflicts([rule('a', 'cmd+b'), rule('a', 'cmd+b')])).toHaveLength(0);
  });

  test('different clauses are reported as a possible overlap', () => {
    const conflicts = findConflicts([rule('a', 'cmd+b', 'editorTextFocus'), rule('b', 'cmd+b', 'composerFocus')]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].certain).toBe(false);
  });

  test('the same clause is certain', () => {
    const conflicts = findConflicts([rule('a', 'cmd+b', 'editorTextFocus'), rule('b', 'cmd+b', 'editorTextFocus')]);
    expect(conflicts[0].certain).toBe(true);
  });

  test('different chords do not conflict', () => {
    expect(findConflicts([rule('a', 'cmd+b'), rule('b', 'cmd+j')])).toHaveLength(0);
  });
});
