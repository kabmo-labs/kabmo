/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The command palette's list.
 *
 * The palette is a VIEW of the keymap, so the property that matters is that it
 * cannot list something the keymap does not bind — an entry that does nothing
 * reads as a broken editor rather than a missing feature. The filter is the
 * other half: a reader looks for a command by its name OR by the shortcut they
 * already know, and both have to find it.
 */

import { describe, expect, test } from 'bun:test';

import { buildPaletteEntries, filterPaletteEntries } from '@/shared/lib/code/editor/palette';
import { EDITOR_KEY_BINDINGS } from '@/shared/lib/code/editor/keymap';

describe('buildPaletteEntries', () => {
  test('every entry is a bound command, labelled with the keymap’s own words', () => {
    const entries = buildPaletteEntries(true);

    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      const binding = EDITOR_KEY_BINDINGS.find((candidate) => candidate.command === entry.command);
      expect(binding).toBeDefined();
      expect(entry.label).toBe(binding!.label);
      // The chord is derived from the same stroke the handler matches, so a
      // listed shortcut is one that actually fires.
      expect(entry.chord.length).toBeGreaterThan(0);
    }
  });

  test('the chord shown is the platform’s own', () => {
    const mac = buildPaletteEntries(true).find((entry) => entry.command === 'selectNextOccurrence');
    const other = buildPaletteEntries(false).find((entry) => entry.command === 'selectNextOccurrence');

    expect(mac?.chord).toBe('⌘D');
    expect(other?.chord).toBe('Ctrl+D');
  });

  test('no command is listed twice', () => {
    const commands = buildPaletteEntries(true).map((entry) => entry.command);
    expect(new Set(commands).size).toBe(commands.length);
  });

  test('a command the keymap does not bind is not listed', () => {
    // `escape` is dispatched by the panel's capture handler, never by a chord, so
    // listing it would promise a shortcut nothing listens for.
    const commands = buildPaletteEntries(true).map((entry) => entry.command);
    expect(commands).not.toContain('escape');
  });

  test('every palette command has a binding — the reason `selectWord` is gone', () => {
    // It was implemented and unreachable for two releases: no chord, and a test that
    // asserted its absence from the palette. Deleting it is what made that state
    // impossible to return to.
    const commands = buildPaletteEntries(true).map((entry) => entry.command);
    expect(commands).toContain('selectLine');
    expect(commands).toContain('insertCursorAbove');
    expect(commands).toContain('goToLine');
  });

  test('folding is listed, with the chord that actually fires', () => {
    const entries = buildPaletteEntries(true);
    const fold = entries.find((entry) => entry.command === 'fold');
    const unfold = entries.find((entry) => entry.command === 'unfold');

    expect(fold?.label).toBe('Fold block');
    expect(fold?.chord).toBe('⌥⌘[');
    expect(unfold?.chord).toBe('⌥⌘]');
    // And the other platform's own spelling, from the same stroke.
    const other = buildPaletteEntries(false).find((entry) => entry.command === 'fold');
    expect(other?.chord).toBe('Ctrl+Shift+[');
  });
});

describe('filterPaletteEntries', () => {
  const entries = buildPaletteEntries(true);

  test('an empty query lists everything, in the palette’s own order', () => {
    expect(filterPaletteEntries(entries, '')).toBe(entries);
    expect(filterPaletteEntries(entries, '   ')).toBe(entries);
  });

  test('matches on the label', () => {
    const found = filterPaletteEntries(entries, 'occurrence').map((entry) => entry.command);
    expect(found).toContain('selectNextOccurrence');
    expect(found).toContain('selectAllOccurrences');
  });

  test('matches on the shortcut, which is how a reader who knows the chord looks', () => {
    const found = filterPaletteEntries(entries, '⌘D').map((entry) => entry.command);
    expect(found).toContain('selectNextOccurrence');
  });

  test('every word has to match, so a two-word query narrows', () => {
    const broad = filterPaletteEntries(entries, 'line');
    const narrow = filterPaletteEntries(entries, 'line up');

    expect(narrow.length).toBeLessThan(broad.length);
    expect(narrow.map((entry) => entry.command)).toContain('moveLineUp');
  });

  test('a query nothing matches yields an empty list rather than everything', () => {
    expect(filterPaletteEntries(entries, 'zzzz')).toEqual([]);
  });

  test('matching ignores case', () => {
    expect(filterPaletteEntries(entries, 'UNDO').map((entry) => entry.command)).toEqual(['undo']);
  });
});
