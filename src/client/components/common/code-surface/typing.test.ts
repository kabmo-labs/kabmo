/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Auto-close and the document-words completer.
 *
 * The completer's bound is the point: a whole-document scan per keystroke is exactly the
 * cost the CodeMirror migration removed (the old surface re-tokenized the visible window
 * per character). What is pinned here is that the window is a WINDOW, that a short word is
 * not offered, and that the list is capped.
 */

import { describe, expect, test } from 'bun:test';
import { CompletionContext } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';

import {
  COMPLETION_MAX_OPTIONS,
  COMPLETION_MIN_WORD,
  COMPLETION_WINDOW_LINES,
  documentWordCompleter,
  documentWords,
  typingExtensions,
} from '@/client/components/common/code-surface/typing';

describe('documentWords', () => {
  test('collects identifiers, including `$` and `_`', () => {
    expect(documentWords('const alpha = $beta + gamma_one;')).toEqual(
      expect.arrayContaining(['const', 'alpha', '$beta', 'gamma_one']),
    );
  });

  test('deduplicates', () => {
    expect(documentWords('alpha alpha alpha').filter((word) => word === 'alpha')).toHaveLength(1);
  });

  test('drops words shorter than the floor', () => {
    // `const` is kept; `ab` is not a useful suggestion.
    expect(documentWords('ab const')).not.toContain('ab');
    expect(COMPLETION_MIN_WORD).toBe(3);
  });
});

describe('documentWordCompleter', () => {
  function complete(doc: string, pos: number, explicit = false) {
    const state = EditorState.create({ doc, selection: { anchor: pos } });
    return documentWordCompleter(new CompletionContext(state, pos, explicit));
  }

  test('offers words from around the caret when typing an identifier', () => {
    const doc = 'const somethingUseful = 1;\nsome';
    const result = complete(doc, doc.length);
    expect(result).not.toBeNull();
    expect(result!.options.map((option) => option.label)).toContain('somethingUseful');
  });

  test('a bare keystroke with nothing typed before it offers nothing', () => {
    const doc = 'const alpha = 1; ';
    expect(complete(doc, doc.length)).toBeNull();
  });

  test('an explicit request offers words even with nothing typed', () => {
    const doc = 'const alpha = 1; ';
    const result = complete(doc, doc.length, true);
    expect(result).not.toBeNull();
  });

  test('the list is capped, so a common prefix does not paint a thousand rows', () => {
    const doc = Array.from({ length: 400 }, (_, index) => `identifier${index}`).join(' ') + ' ident';
    const result = complete(doc, doc.length);
    expect(result!.options.length).toBeLessThanOrEqual(COMPLETION_MAX_OPTIONS);
  });

  test('the window is bounded, so a huge file does not offer words from its far end', () => {
    // The document is twice the window: a word only at the top must not be offered from a
    // caret at the bottom.
    const far = Array.from({ length: COMPLETION_WINDOW_LINES * 2 + 20 }, (_, index) => `line${index} filler`).join('\n');
    const doc = `distantIdentifier\n${far}\nident`;
    const result = complete(doc, doc.length);
    const labels = result!.options.map((option) => option.label);
    expect(labels).not.toContain('distantIdentifier');
  });
});

describe('typingExtensions', () => {
  test('both off answers an empty list, which is what makes the setting a real toggle', () => {
    expect(typingExtensions({ autoCloseBrackets: false, autocomplete: false })).toEqual([]);
  });

  test('either on answers extensions', () => {
    expect(typingExtensions({ autoCloseBrackets: true, autocomplete: false }).length).toBeGreaterThan(0);
    expect(typingExtensions({ autoCloseBrackets: false, autocomplete: true }).length).toBeGreaterThan(0);
    expect(typingExtensions({ autoCloseBrackets: true, autocomplete: true }).length).toBeGreaterThan(1);
  });
});
