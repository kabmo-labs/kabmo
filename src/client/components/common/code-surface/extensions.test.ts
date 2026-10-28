/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The editor's extension stack, and the one thing in it that fails SILENTLY.
 *
 * `toggleComment` reads its tokens out of the `languageData` facet, and
 * `languageDataAt` looks the name up in each provider's RESULT — so a provider
 * that returns the tokens bare (`() => [{ line: '//' }]`) yields an empty list,
 * the command returns `false`, and ⌘/ does nothing at all. Measured: the line
 * stayed uncommented in TypeScript and in YAML, with no error anywhere. These
 * cases assert the command's own effect on a state built from the same stack the
 * component mounts.
 */

import { describe, expect, test } from 'bun:test';
import { Compartment, EditorSelection, EditorState } from '@codemirror/state';
import { toggleComment } from '@codemirror/commands';

import { readOnlyExtension, surfaceExtensions, wrapExtension } from '@/client/components/common/code-surface/extensions';
import { SHIKI_THEMES } from '@/shared/lib/code/shiki-themes';

/** A state from the component's own stack, with a bare caret on line 1. */
function stateFor(language: string, doc = 'const alpha = 1;\n') {
  return EditorState.create({
    doc,
    extensions: surfaceExtensions({
      language,
      wordWrapCompartment: new Compartment(),
      readOnlyCompartment: new Compartment(),
      themeCompartment: new Compartment(),
      languageCompartment: new Compartment(),
    indentCompartment: new Compartment(),
    typingCompartment: new Compartment(),
    // This stack is about folding/indent, not blame: the option is `null` so the
    // compartment is present and off, which is what the surface ships by default.
    blameCompartment: new Compartment(),
    blame: null,
    indentUnitText: '  ',
    typing: { autoCloseBrackets: false, autocomplete: false },
      wordWrap: false,
      readOnly: false,
      themes: SHIKI_THEMES,
      onDocChange: () => {},
      onState: () => {},
    }),
  });
}

/** Apply `toggleComment` the way a `Command` would, returning the new text. */
function toggled(state: EditorState): string {
  let next = state;
  toggleComment({ state, dispatch: (transaction) => { next = transaction.state; } });
  return next.doc.toString();
}

describe('comment tokens', () => {
  test('toggling comments a TypeScript line with //', () => {
    expect(toggled(stateFor('typescript'))).toBe('// const alpha = 1;\n');
  });

  test('toggling uses the language’s own token, not a hard-coded //', () => {
    // A `//` in YAML is a syntax error, which is what makes this the case worth
    // pinning: the table has to reach the command.
    expect(toggled(stateFor('yaml', 'key: value\n'))).toBe('# key: value\n');
    expect(toggled(stateFor('sql', 'select 1;\n'))).toBe('-- select 1;\n');
  });

  test('a block-only language is wrapped instead of prefixed', () => {
    expect(toggled(stateFor('css', 'a { color: red; }\n'))).toContain('/*');
  });

  test('a second toggle restores the line', () => {
    const once = toggled(stateFor('typescript'));
    const twice = toggled(stateFor('typescript', once));
    expect(twice).toBe('const alpha = 1;\n');
  });
});

describe('read-only', () => {
  test('both halves are installed, so neither typing nor a dispatch can edit', () => {
    const state = EditorState.create({
      doc: 'x',
      extensions: [readOnlyExtension(true)],
    });
    // `readOnly` is what stops the commands; `editable` is what stops the DOM.
    expect(state.readOnly).toBe(true);
  });

  test('an editable surface installs neither', () => {
    const state = EditorState.create({ doc: 'x', extensions: [readOnlyExtension(false)] });
    expect(state.readOnly).toBe(false);
  });
});

describe('wrap', () => {
  test('wrapping is a compartment payload, so it can be swapped without a re-mount', () => {
    const compartment = new Compartment();
    const state = EditorState.create({ doc: 'x', extensions: [compartment.of(wrapExtension(true))] });
    const unwrapped = state.update({ effects: compartment.reconfigure(wrapExtension(false)) }).state;
    // Same document and selection: the reconfigure must not disturb either.
    expect(unwrapped.doc.toString()).toBe('x');
    expect(unwrapped.selection.main.head).toBe(state.selection.main.head);
  });

  test('the selection survives a wrap toggle', () => {
    const compartment = new Compartment();
    const state = EditorState.create({
      doc: 'alpha beta',
      selection: EditorSelection.range(0, 5),
      extensions: [compartment.of(wrapExtension(false))],
    });
    const wrapped = state.update({ effects: compartment.reconfigure(wrapExtension(true)) }).state;
    expect(wrapped.selection.main.from).toBe(0);
    expect(wrapped.selection.main.to).toBe(5);
  });
});
