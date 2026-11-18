/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The catalog is the single source for a command's title and chord, so a row
 * that exists only in a menu or only in a palette is a bug by construction.
 *
 * These cases pin the two commands the native menu bar reaches for — a rename
 * would leave the menu row calling an id nothing registers, which is silent in
 * the app (the row simply does nothing) and is exactly what this file exists to
 * catch.
 */

import { describe, expect, test } from 'bun:test';
import { BUILTIN_COMMANDS } from '@/shared/lib/commands/catalog';

describe('the built-in catalog', () => {
  test('every id is unique', () => {
    const ids = BUILTIN_COMMANDS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('New Session is a command with ⌘N', () => {
    const entry = BUILTIN_COMMANDS.find((candidate) => candidate.id === 'workspace.newSession');
    expect(entry?.title).toBe('New Session');
    expect(entry?.defaultKey?.mac).toEqual([{ code: 'KeyN', meta: true }]);
  });

  test('Check for Updates is a command with no chord', () => {
    const entry = BUILTIN_COMMANDS.find((candidate) => candidate.id === 'workspace.checkUpdates');
    expect(entry?.title).toBe('Check for Updates');
    expect(entry?.defaultKey).toBeUndefined();
  });
});
