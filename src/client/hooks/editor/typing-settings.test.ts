/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The typing settings.
 *
 * Both default ON — that is what every editor does, and a user who never opens Settings
 * must not get an editor whose typing behaves unlike every other. Each key falls back
 * INDEPENDENTLY, so a stored `autocomplete: false` does not also disable auto-close.
 */

import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';

import {
  DEFAULT_EDITOR_TYPING,
  EDITOR_TYPING_CHANGED_EVENT,
  currentEditorTyping,
} from '@/client/hooks/editor/typing-settings';
import { primeKabmoSettings } from '@/shared/lib/settings/client';

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
  primeKabmoSettings({});
});

describe('currentEditorTyping', () => {
  test('both default ON', () => {
    expect(currentEditorTyping()).toEqual(DEFAULT_EDITOR_TYPING);
    expect(DEFAULT_EDITOR_TYPING).toEqual({ autoCloseBrackets: true, autocomplete: true });
  });

  test('each key falls back on its own', () => {
    primeKabmoSettings({ kabmo_settings: { editorAutocomplete: false } });
    // Turning the completer off must not also turn auto-close off: they are two
    // decisions, and a shared fallback would couple them.
    expect(currentEditorTyping()).toEqual({ autoCloseBrackets: true, autocomplete: false });

    primeKabmoSettings({ kabmo_settings: { editorAutoCloseBrackets: false } });
    expect(currentEditorTyping()).toEqual({ autoCloseBrackets: false, autocomplete: true });
  });

  test('a non-boolean value falls back rather than being coerced', () => {
    primeKabmoSettings({ kabmo_settings: { editorAutocomplete: 'no', editorAutoCloseBrackets: 0 } });
    expect(currentEditorTyping()).toEqual(DEFAULT_EDITOR_TYPING);
  });

  test('an explicit false is honoured, which is the whole point of the setting', () => {
    primeKabmoSettings({ kabmo_settings: { editorAutocomplete: false, editorAutoCloseBrackets: false } });
    expect(currentEditorTyping()).toEqual({ autoCloseBrackets: false, autocomplete: false });
  });
});

describe('the live event', () => {
  test('the name is the one the editor subscribes to', () => {
    expect(EDITOR_TYPING_CHANGED_EVENT).toBe('omp:editor-typing-changed');
  });
});
