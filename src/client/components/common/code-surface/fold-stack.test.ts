/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Folding and bracket matching as the COMPONENT mounts them.
 *
 * `fold.test.ts` pins the indent rule in isolation; this file pins that the
 * stack actually wires it, because every way this feature fails is silent:
 *
 * - `foldGutter()` without a `foldService` draws a gutter and offers no marker —
 *   the editor looks like it has folding and does not.
 * - A `foldEffect` dispatched into a state with no `foldState` field is
 *   DISCARDED with no error (measured: no placeholder, no throw), which is why
 *   `foldGutter()` — not `codeFolding()` — is the entry point here: it brings
 *   the field.
 * - `bracketMatching()` is a `ViewPlugin`, so a state-level assertion cannot see
 *   it at all. The decorations only exist once a view mounts, which is why the
 *   bracket cases mount one.
 *
 * The bracket expectations are TEXTUAL, and that is the documented trade: no
 * lezer grammar is installed, so a brace inside a string can be paired with one
 * in another string. `extensions.ts` states the trade; this file makes sure the
 * behaviour that ships is the behaviour that was decided.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { foldEffect, foldedRanges, foldable, foldState } from '@codemirror/language';

import { surfaceExtensions } from '@/client/components/common/code-surface/extensions';
import { SHIKI_THEMES } from '@/shared/lib/code/shiki-themes';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

const EXTRA_GLOBALS = ['MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame'] as const;
const native: Partial<Record<(typeof EXTRA_GLOBALS)[number], unknown>> = {};

let host: HTMLElement;

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  installDomGlobals(win);
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of EXTRA_GLOBALS) {
    native[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
  host = document.body.appendChild(document.createElement('div'));
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of EXTRA_GLOBALS) {
    if (native[key] === undefined) delete target[key];
    else target[key] = native[key];
  }
  restoreDomGlobals();
});

/** A state from the component's own stack. */
function stateFor(language: string, doc: string, readOnly = false): EditorState {
  return EditorState.create({
    doc,
    extensions: surfaceExtensions({
      language,
      wordWrapCompartment: new Compartment(),
      readOnlyCompartment: new Compartment(),
      themeCompartment: new Compartment(),
      wordWrap: false,
      readOnly,
      themes: SHIKI_THEMES,
      onDocChange: () => {},
      onState: () => {},
    }),
  });
}

describe('folding', () => {
  test('the stack installs the fold state, so a fold effect is not discarded', () => {
    const state = stateFor('typescript', 'function f() {\n  a();\n}\n');
    expect(state.field(foldState, false)).toBeDefined();
  });

  test('CM6’s own foldable() agrees with the indent rule', () => {
    // `foldable` is what the gutter marker and the fold commands both ask; a
    // service that is registered but never consulted would look identical to a
    // working one from the rule's own tests.
    const state = stateFor('typescript', 'function f() {\n  a();\n  b();\n}\nafter();\n');
    const line = state.doc.line(1);
    expect(foldable(state, line.from, line.to)).toEqual({
      from: line.to,
      to: state.doc.line(3).to,
    });
  });

  test('a plain line is not foldable', () => {
    const state = stateFor('typescript', 'const a = 1;\n');
    const line = state.doc.line(1);
    expect(foldable(state, line.from, line.to)).toBeNull();
  });

  test('folding a range hides its lines and leaves the placeholder', () => {
    const view = new EditorView({
      parent: host,
      state: stateFor('typescript', 'function f() {\n  a();\n  b();\n}\nafter();\n'),
    });
    try {
      const line = view.state.doc.line(1);
      view.dispatch({
        effects: foldEffect.of({ from: line.to, to: view.state.doc.line(3).to }),
      });
      expect(view.contentDOM.querySelector('.cm-foldPlaceholder')).not.toBeNull();
      const ranges: string[] = [];
      foldedRanges(view.state).between(0, view.state.doc.length, (from, to) => {
        ranges.push(`${from}-${to}`);
      });
      expect(ranges).toEqual([`${line.to}-${view.state.doc.line(3).to}`]);
    } finally {
      view.destroy();
    }
  });

  test('a read-only viewer still folds — the diff panel and chat cards rely on it', () => {
    const view = new EditorView({
      parent: host,
      state: stateFor('typescript', 'function f() {\n  a();\n}\n', true),
    });
    try {
      const line = view.state.doc.line(1);
      view.dispatch({ effects: foldEffect.of({ from: line.to, to: view.state.doc.line(2).to }) });
      expect(view.contentDOM.querySelector('.cm-foldPlaceholder')).not.toBeNull();
    } finally {
      view.destroy();
    }
  });

  test('the gutter offers a marker on a foldable line and none on a plain one', () => {
    const view = new EditorView({
      parent: host,
      state: stateFor('typescript', 'function f() {\n  a();\n}\nconst x = 1;\n'),
    });
    try {
      // `foldGutter` draws an `initialSpacer` marker that reserves the gutter's
      // width: it is a real `.cm-gutterElement` with `visibility: hidden`, so a
      // count over that selector includes it. Only the visible ones are markers
      // the reader can click.
      const markers = Array.from(view.dom.querySelectorAll('.cm-foldGutter .cm-gutterElement span')).filter(
        (node) => !(node.parentElement?.getAttribute('style') ?? '').includes('hidden'),
      );
      // One marker: the foldable line. `const x = 1;` is not foldable.
      expect(markers.length).toBe(1);
      expect(markers[0]?.textContent).toBe('⌄');
    } finally {
      view.destroy();
    }
  });

  test('a document with nothing foldable draws no visible marker', () => {
    const view = new EditorView({ parent: host, state: stateFor('typescript', 'const a = 1;\nconst b = 2;\n') });
    try {
      const markers = Array.from(view.dom.querySelectorAll('.cm-foldGutter .cm-gutterElement span')).filter(
        (node) => !(node.parentElement?.getAttribute('style') ?? '').includes('hidden'),
      );
      expect(markers).toEqual([]);
    } finally {
      view.destroy();
    }
  });
});

describe('bracket matching', () => {
  /** The classes `bracketMatching()` painted for the caret at `pos`. */
  function marksFor(doc: string, pos: number): string[] {
    const view = new EditorView({ parent: host, state: stateFor('typescript', doc) });
    try {
      view.dispatch({ selection: { anchor: pos } });
      return Array.from(view.contentDOM.querySelectorAll('.cm-matchingBracket, .cm-nonmatchingBracket')).map(
        (node) => node.textContent ?? '',
      );
    } finally {
      view.destroy();
    }
  }

  test('the caret next to an opening brace paints both ends of the pair', () => {
    const doc = 'function f() {\n  a();\n}\n';
    expect(marksFor(doc, doc.indexOf('{') + 1)).toEqual(['{', '}']);
  });

  test('the caret next to the CLOSING brace paints the same pair', () => {
    const doc = 'function f() {\n  a();\n}\n';
    const closing = doc.lastIndexOf('}');
    expect(marksFor(doc, closing)).toEqual(['{', '}']);
  });

  test('an unmatched brace is painted as unmatched rather than left blank', () => {
    const doc = 'function f() {\n  a();\n';
    const view = new EditorView({ parent: host, state: stateFor('typescript', doc) });
    try {
      view.dispatch({ selection: { anchor: doc.indexOf('{') + 1 } });
      expect(view.contentDOM.querySelectorAll('.cm-nonmatchingBracket').length).toBe(1);
    } finally {
      view.destroy();
    }
  });

  test('a caret in ordinary text paints nothing', () => {
    expect(marksFor('const alpha = 1;\n', 8)).toEqual([]);
  });
});
