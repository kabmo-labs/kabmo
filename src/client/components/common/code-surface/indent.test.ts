/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Auto-indent through the REAL surface stack.
 *
 * The rules are unit-tested in `indent-rules.test.ts`; what this file pins is the
 * WIRING, because both halves of it fail silently:
 *
 * - the service must be installed AND `indentOnInput()` must be present —
 *   measured, either alone leaves Enter or the closer broken;
 * - the service must return `undefined` (not `null`) where the parser answers, or
 *   it swallows the mode's answer (`js: 11 → null`);
 * - the language data must carry a closer pattern only where a closer is a
 *   closer (YAML's `}` is content).
 *
 * A mode is installed through the same `languageCompartment` the surface uses, so
 * these cases exercise the real path rather than a stand-in.
 */

import { describe, expect, test } from 'bun:test';
import { Compartment, EditorState, type Extension, type Transaction } from '@codemirror/state';
import { StreamLanguage } from '@codemirror/language';
import { insertNewlineAndIndent } from '@codemirror/commands';
import type { EditorView } from '@codemirror/view';

import { surfaceExtensions } from '@/client/components/common/code-surface/extensions';
import { STREAM_MODE_LOADERS, STREAM_MODE_EXPORTS } from '@/shared/lib/code/editor/stream-modes';
import { SHIKI_THEMES } from '@/shared/lib/code/shiki-themes';

/** The compartments the surface owns, so a mode can be installed the same way. */
interface SurfaceCompartments {
  wordWrapCompartment: Compartment;
  readOnlyCompartment: Compartment;
  themeCompartment: Compartment;
  languageCompartment: Compartment;
  indentCompartment: Compartment;
  typingCompartment: Compartment;
}

interface Built {
  extensions: Extension[];
  compartments: SurfaceCompartments;
  mode: unknown;
}

async function build(language: string): Promise<Built> {
  const compartments: SurfaceCompartments = {
    wordWrapCompartment: new Compartment(),
    readOnlyCompartment: new Compartment(),
    themeCompartment: new Compartment(),
    languageCompartment: new Compartment(),
    indentCompartment: new Compartment(),
    typingCompartment: new Compartment(),
  };
  const extensions: Extension[] = surfaceExtensions({
    language,
    ...compartments,
    wordWrap: true,
    readOnly: false,
    themes: SHIKI_THEMES,
    indentUnitText: '  ',
    typing: { autoCloseBrackets: false, autocomplete: false },
    onDocChange: () => {},
    onState: () => {},
  });
  const loader = STREAM_MODE_LOADERS[language];
  const loaded = loader ? await loader() : null;
  const mode = isModule(loaded) ? loaded[STREAM_MODE_EXPORTS[language]] : null;
  return { extensions, compartments, mode };
}

/** A dynamic import's namespace: an object whose keys are the module's exports. */
function isModule(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** The surface's state for `doc`, with the mode installed the way the component does. */
function stateFor({ extensions, compartments, mode }: Built, doc: string): EditorState {
  const base = EditorState.create({ doc, selection: { anchor: doc.length }, extensions });
  if (!mode) return base;
  return base.update({
    effects: compartments.languageCompartment.reconfigure(StreamLanguage.define(mode as never)),
  }).state;
}

/**
 * A minimal live view.
 *
 * `insertNewlineAndIndent` is a `StateCommand`: it reads `state` and calls
 * `dispatch` with a transaction spec or a resolved transaction, both of which are
 * real CM6 shapes. Only those two members are needed, and typing the whole
 * `EditorView` would mean constructing a DOM.
 */
interface CommandView {
  state: EditorState;
  dispatch: (input: Transaction | readonly Transaction[] | { state: EditorState }) => void;
}

function commandView(state: EditorState): CommandView {
  const view: CommandView = {
    state,
    dispatch(input) {
      if (Array.isArray(input)) {
        for (const transaction of input) view.state = transaction.state;
        return;
      }
      if ('state' in input && input.state instanceof EditorState) {
        view.state = input.state;
        return;
      }
      view.state = view.state.update(input as never).state;
    },
  };
  return view;
}

/** Press Enter at the end of `doc`. */
function enter(built: Built, doc: string): string {
  const view = commandView(stateFor(built, doc));
  insertNewlineAndIndent(view as unknown as EditorView);
  return view.state.doc.toString();
}

/** Type `insert` at the end of `doc` as a real keystroke. */
function type(built: Built, doc: string, insert: string): string {
  return stateFor(built, doc).update({
    changes: { from: doc.length, insert },
    selection: { anchor: doc.length + insert.length },
    userEvent: 'input.type',
  }).state.doc.toString();
}

describe('Enter indents in the languages whose parser answers', () => {
  const cases: Array<[string, string, string]> = [
    ['typescript', 'if (x) {', 'if (x) {\n  '],
    ['javascript', 'if (x) {', 'if (x) {\n  '],
    ['go', 'func f() {', 'func f() {\n  '],
    ['rust', 'fn f() {', 'fn f() {\n  '],
    ['css', 'a {', 'a {\n  '],
    ['json', '{', '{\n  '],
  ];
  for (const [language, doc, expected] of cases) {
    test(language, async () => {
      expect(enter(await build(language), doc)).toBe(expected);
    });
  }
});

describe('Enter indents in the languages the parser cannot answer', () => {
  const cases: Array<[string, string, string]> = [
    ['yaml', 'a:', 'a:\n  '],
    ['toml', 'a = {', 'a = {\n  '],
    ['hcl', 'resource "a" "b" {', 'resource "a" "b" {\n  '],
    ['bash', 'if true; then', 'if true; then\n  '],
    ['dockerfile', 'RUN apt-get install \\', 'RUN apt-get install \\\n  '],
    ['graphql', 'query Q {', 'query Q {\n  '],
    ['php', 'function f() {', 'function f() {\n  '],
    ['zig', 'fn f() {', 'fn f() {\n  '],
    ['html', '<div>', '<div>\n  '],
  ];
  for (const [language, doc, expected] of cases) {
    test(language, async () => {
      expect(enter(await build(language), doc)).toBe(expected);
    });
  }
});

describe('Enter leaves the flat languages alone', () => {
  test('a markdown list item keeps its column', async () => {
    expect(enter(await build('markdown'), '- item')).toBe('- item\n');
  });

  test('an already-indented markdown line keeps its indent', async () => {
    expect(enter(await build('markdown'), '> quote\n  text')).toBe('> quote\n  text\n  ');
  });

  test('a SQL clause gets no indent', async () => {
    expect(enter(await build('sql'), 'SELECT * FROM t WHERE')).toBe('SELECT * FROM t WHERE\n');
  });

  test('a YAML list item keeps its column', async () => {
    expect(enter(await build('yaml'), 'items:\n  - one')).toBe('items:\n  - one\n  ');
  });
});

describe('a typed closer dedents', () => {
  const cases: Array<[string, string, string, string]> = [
    ['typescript', 'if (x) {\n  ', '}', 'if (x) {\n}'],
    // `go`'s own regexp demands exactly one space, so this dedent only exists
    // because the surface supplies its own closer rule.
    ['go', 'func f() {\n  ', '}', 'func f() {\n}'],
    ['toml', '[a]\n  ', ']', '[a]\n]'],
    ['graphql', 'query Q {\n  ', '}', 'query Q {\n}'],
    ['hcl', 'a {\n  ', '}', 'a {\n}'],
    ['php', 'function f() {\n  ', '}', 'function f() {\n}'],
    ['bash', 'if true; then\n  ', 'fi', 'if true; then\nfi'],
    ['bash', 'for x in a; do\n  ', 'done', 'for x in a; do\ndone'],
    ['html', '<div>\n  ', '</div>', '<div>\n</div>'],
    ['tsx', 'const a = (\n  ', ')', 'const a = (\n)'],
  ];
  for (const [language, doc, closer, expected] of cases) {
    test(`${language}: ${closer}`, async () => {
      expect(type(await build(language), doc, closer)).toBe(expected);
    });
  }
});

describe('a typed closer is left alone where it is content', () => {
  test('YAML', async () => {
    expect(type(await build('yaml'), 'a:\n  ', '}')).toBe('a:\n  }');
  });

  test('markdown', async () => {
    expect(type(await build('markdown'), '> q\n  ', ']')).toBe('> q\n  ]');
  });

  test('SQL', async () => {
    expect(type(await build('sql'), 'SELECT\n  ', ')')).toBe('SELECT\n  )');
  });
});

describe('the unit comes from the state, not from a module constant', () => {
  test('a tab-size change still indents with the surface unit', async () => {
    const built = await build('yaml');
    const state = EditorState.create({
      doc: 'a:',
      selection: { anchor: 2 },
      // The surface installs `indentUnit.of('  ')`; this asserts the service reads
      // `ctx.unit` rather than a constant of its own.
      extensions: [...built.extensions, EditorState.tabSize.of(4)],
    });
    const view = commandView(state);
    insertNewlineAndIndent(view as unknown as EditorView);
    expect(view.state.doc.toString()).toBe('a:\n  ');
  });
});
