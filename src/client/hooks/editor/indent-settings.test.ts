/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The indentation setting.
 *
 * Two things are pinned here. The stored value is GUARDED on read — a width outside
 * the offered set is a downgrade or a hand-edited row, and configuring the surface
 * with a value the picker cannot show is a setting the user cannot change back. And
 * a tab-indented unit is `'\t'`, the only spelling `indentUnit` accepts for a tab: the
 * facet is documented as "a string consisting entirely of the same whitespace
 * character", so a mixture would be a facet that silently does nothing.
 */

import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';

import {
  DEFAULT_EDITOR_INDENT,
  EDITOR_INDENT_CHANGED_EVENT,
  currentEditorIndent,
  indentUnitFor,
} from '@/client/hooks/editor/indent-settings';
import { primeKabmoSettings, writeKabmoSettings } from '@/shared/lib/settings/client';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Event', 'CustomEvent'] as const;
const native: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};
const win = new Window({ url: 'http://localhost' });
for (const key of DOM_GLOBALS) {
  const target = globalThis as unknown as Record<string, unknown>;
  native[key] = target[key];
  target[key] = (win as unknown as Record<string, unknown>)[key];
}

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) target[key] = native[key];
});

afterEach(() => {
  // The blob is module-level in the settings client, so every case primes it.
  primeKabmoSettings({});
});

describe('currentEditorIndent', () => {
  test('an unset value reads as the shipped default', () => {
    expect(currentEditorIndent()).toEqual(DEFAULT_EDITOR_INDENT);
    expect(DEFAULT_EDITOR_INDENT).toEqual({ width: 2, insertSpaces: true });
  });

  test('a stored width and spaces flag are adopted', () => {
    primeKabmoSettings({ kabmo_settings: { editorIndentWidth: 4, editorInsertSpaces: true } });
    expect(currentEditorIndent()).toEqual({ width: 4, insertSpaces: true });
  });

  test('a width outside the offered set falls back, so the picker can still show it', () => {
    // A downgrade or a hand-edited row must not configure the surface with a value
    // the picker cannot represent — that would be a setting with no way back.
    primeKabmoSettings({ kabmo_settings: { editorIndentWidth: 3 } });
    expect(currentEditorIndent().width).toBe(2);
    primeKabmoSettings({ kabmo_settings: { editorIndentWidth: '4' } });
    expect(currentEditorIndent().width).toBe(2);
  });

  test('a non-boolean spaces flag falls back', () => {
    primeKabmoSettings({ kabmo_settings: { editorInsertSpaces: 'no' } });
    expect(currentEditorIndent().insertSpaces).toBe(true);
  });

  test('a tab-indented setting is preserved', () => {
    primeKabmoSettings({ kabmo_settings: { editorIndentWidth: 4, editorInsertSpaces: false } });
    expect(currentEditorIndent()).toEqual({ width: 4, insertSpaces: false });
  });
});

describe('indentUnitFor', () => {
  test('spaces become a run of that many spaces', () => {
    expect(indentUnitFor({ width: 2, insertSpaces: true })).toBe('  ');
    expect(indentUnitFor({ width: 4, insertSpaces: true })).toBe('    ');
    expect(indentUnitFor({ width: 8, insertSpaces: true })).toBe('        ');
  });

  test('a tab-indented setting is ONE tab, whatever the width says', () => {
    // `indentUnit` requires a string of one repeated whitespace character, so a
    // width is meaningless here — mixing them would be a facet that does nothing.
    expect(indentUnitFor({ width: 4, insertSpaces: false })).toBe('\t');
    expect(indentUnitFor({ width: 2, insertSpaces: false })).toBe('\t');
  });
});

describe('the live event', () => {
  test('the event name is the one the editor subscribes to', () => {
    // Both ends state this string, so a rename on one side would silently stop
    // reaching an open editor.
    expect(EDITOR_INDENT_CHANGED_EVENT).toBe('omp:editor-indent-changed');
  });

  test('a write lands in the blob the readers resolve', () => {
    writeKabmoSettings({ editorIndentWidth: 8 });
    expect(currentEditorIndent().width).toBe(8);
  });
});
