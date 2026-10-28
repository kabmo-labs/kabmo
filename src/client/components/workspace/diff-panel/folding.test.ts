/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Folding and brace detection in the DIFF bodies.
 *
 * Two layers, because each can be wrong on its own:
 *
 * - The RULE (`braceFoldRange`) is pure, and every way it fails is a boundary:
 *   an opener that does not really close, a pair that hides nothing, a cap that
 *   would cut a block at a line the reader never chose.
 * - The MOUNTED STACK is what proves the feature exists at all. `foldGutter()`
 *   without a `foldService` draws a gutter and offers no marker; a `foldEffect`
 *   dispatched into a state with no `foldState` field is discarded with no
 *   error; and `bracketMatching()` is a `ViewPlugin`, so nothing at the state
 *   level can see it. Both diff shapes are mounted for that reason — the split
 *   view has TWO states, and each one needs its own field and service.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { foldEffect, foldState, foldable } from '@codemirror/language';

import { braceFoldRange, diffFoldingExtensions } from '@/client/components/workspace/diff-panel/folding';
import { mountSplitDiff, mountUnifiedDiff } from '@/client/components/workspace/diff-panel/merge';
import { MAX_FOLD_LINES } from '@/client/components/common/code-surface/fold';
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

function stateOf(doc: string): EditorState {
  return EditorState.create({ doc, extensions: diffFoldingExtensions });
}

/** The fold for line `number` (1-based), as `[startLine, endLine]` or null. */
function foldAt(state: EditorState, number: number): [number, number] | null {
  const line = state.doc.line(number);
  const range = foldable(state, line.from, line.to);
  if (!range) return null;
  return [state.doc.lineAt(range.from).number, state.doc.lineAt(range.to).number];
}

function diffOptions(original: string, next: string) {
  return {
    original,
    next,
    language: 'typescript',
    wordWrap: false,
    collapse: 'full' as const,
    scrollTestId: 'diff-fold-test',
    onScroller: () => {},
  };
}

/** The view inside the FIRST editor of a mounted host. */
function viewIn(element: Element): EditorView {
  const editor = EditorView.findFromDOM(element as HTMLElement);
  if (!editor) throw new Error('no EditorView inside the mounted host');
  return editor;
}

function foldMarkers(element: Element): string[] {
  // `foldGutter` draws an `initialSpacer` marker that reserves the gutter's
  // width — a real `.cm-gutterElement` with `visibility: hidden`. Only the
  // visible ones are markers the reader can click.
  return Array.from(element.querySelectorAll('.cm-foldGutter .cm-gutterElement span'))
    .filter((node) => !(node.parentElement?.getAttribute('style') ?? '').includes('hidden'))
    .map((node) => node.textContent ?? '');
}

describe('braceFoldRange', () => {
  test('a brace block folds down to the line before its closing brace', () => {
    const state = stateOf('function f() {\n  a();\n  b();\n}\nafter();\n');
    expect(foldAt(state, 1)).toEqual([1, 3]);
  });

  test('the fold starts after the opener LINE, so the opener stays visible', () => {
    const state = stateOf('function f() {\n  a();\n}\n');
    const line = state.doc.line(1);
    const range = braceFoldRange(state, line.from, line.to);
    expect(range?.from).toBe(line.to);
  });

  test('a pair that closes on the NEXT line hides nothing and does not fold', () => {
    const state = stateOf('call(\n  a);\nother();\n');
    // The `(` closes on line 2, so the range would hide nothing at all.
    expect(braceFoldRange(state, 0, state.doc.line(1).to)).toBeNull();
  });

  test('an opener with no closer is refused by the brace rule, not folded to the end', () => {
    const state = stateOf('function f() {\n  a();\n');
    // The brace rule itself must answer null; `foldAt` would still fold the
    // body by INDENTATION, which is the fallback doing its job.
    expect(braceFoldRange(state, 0, state.doc.line(1).to)).toBeNull();
  });

  test('a same-line pair is skipped in favour of the outer block', () => {
    const state = stateOf('function f(a, b) {\n  call(a);\n}\n');
    // `(` closes on line 1, so the `{` is the pair that spans lines.
    expect(foldAt(state, 1)).toEqual([1, 2]);
  });

  test('a nested block folds to its OWN closer', () => {
    const state = stateOf('if (a) {\n  if (b) {\n    c();\n  }\n  d();\n}\n');
    expect(foldAt(state, 1)).toEqual([1, 5]);
    expect(foldAt(state, 2)).toEqual([2, 3]);
  });

  test('a bracket list folds the same way a brace block does', () => {
    const state = stateOf('const x = [\n  1,\n  2,\n];\nnext();\n');
    expect(foldAt(state, 1)).toEqual([1, 3]);
  });

  test('a one-line block does not fold', () => {
    const state = stateOf('if (a) { b(); }\nnext();\n');
    expect(foldAt(state, 1)).toBeNull();
  });

  test('mismatched bracket types do not swallow each other', () => {
    // A `(` counter that also counted `}` would pair this `{` with the `)`.
    const state = stateOf('call(a, {\n  b: 1,\n});\nnext();\n');
    expect(foldAt(state, 1)).toEqual([1, 2]);
  });

  test('a block past the cap is REFUSED rather than truncated', () => {
    const state = stateOf('function f() {\n' + '  x();\n'.repeat(MAX_FOLD_LINES + 10) + '}\n');
    expect(foldAt(state, 1)).toBeNull();
  });

  test('a block inside the cap still folds', () => {
    const state = stateOf('function f() {\n' + '  x();\n'.repeat(50) + '}\n');
    expect(foldAt(state, 1)).toEqual([1, 51]);
  });

  test('the indentation rule still answers where no bracket spans lines', () => {
    const state = stateOf('key:\n  a: 1\n  b: 2\nnext: 1\n');
    // No brace on line 1: this fold is `indentFoldService`'s.
    expect(foldAt(state, 1)).toEqual([1, 3]);
    expect(braceFoldRange(state, 0, state.doc.line(1).to)).toBeNull();
  });
});

describe('the mounted diff stack', () => {
  test('a unified diff installs the fold state and offers a marker', () => {
    const element = host.appendChild(document.createElement('div'));
    const handle = mountUnifiedDiff(element, diffOptions('const a = 1;\n', 'function g() {\n  a();\n}\n'));
    try {
      const view = viewIn(element);
      expect(view.state.field(foldState, false)).toBeDefined();
      expect(foldMarkers(element)).toHaveLength(1);
    } finally {
      handle.destroy();
      element.remove();
    }
  });

  test('a folded block in a unified diff draws the placeholder', () => {
    const element = host.appendChild(document.createElement('div'));
    const handle = mountUnifiedDiff(element, diffOptions('const a = 1;\n', 'function g() {\n  a();\n  b();\n}\n'));
    try {
      const view = viewIn(element);
      expect(view.state.doc.lines).toBe(5);
      const before = view.contentDOM.querySelectorAll('.cm-line').length;
      view.dispatch({
        effects: foldEffect.of({ from: view.state.doc.line(1).to, to: view.state.doc.line(3).to }),
      });
      expect(view.contentDOM.querySelector('.cm-foldPlaceholder')).not.toBeNull();
      expect(view.contentDOM.querySelectorAll('.cm-line').length).toBeLessThan(before);
    } finally {
      handle.destroy();
      element.remove();
    }
  });

  test('a unified diff paints both ends of the caret’s brace pair', () => {
    const element = host.appendChild(document.createElement('div'));
    const doc = 'function g() {\n  a();\n}\n';
    const handle = mountUnifiedDiff(element, diffOptions('const a = 1;\n', doc));
    try {
      const view = viewIn(element);
      view.dispatch({ selection: { anchor: doc.indexOf('{') + 1 } });
      const painted = Array.from(
        view.contentDOM.querySelectorAll('.cm-matchingBracket'),
      ).map((node) => node.textContent);
      expect(painted).toEqual(['{', '}']);
    } finally {
      handle.destroy();
      element.remove();
    }
  });

  test('the guide draws the rows between the caret’s brace and its pair', () => {
    const element = host.appendChild(document.createElement('div'));
    const doc = 'function g() {\n  a();\n  b();\n}\n';
    const handle = mountUnifiedDiff(element, diffOptions('const a = 1;\n', doc));
    try {
      const view = viewIn(element);
      view.dispatch({ selection: { anchor: doc.indexOf('{') + 1 } });
      // The two body rows; the opener and the closer keep their own lines.
      expect(view.contentDOM.querySelectorAll('.cm-line.cm-bracket-guide')).toHaveLength(2);
    } finally {
      handle.destroy();
      element.remove();
    }
  });

  test('BOTH halves of a split diff fold independently', () => {
    const element = host.appendChild(document.createElement('div'));
    const handle = mountSplitDiff(element, diffOptions('before();\n', 'function g() {\n  a();\n}\n'));
    try {
      const editors = Array.from(element.querySelectorAll('.cm-editor'));
      expect(editors).toHaveLength(2);
      for (const editor of editors) {
        const view = viewIn(editor);
        expect(view.state.field(foldState, false)).toBeDefined();
      }
      // Only the new side has a brace block, so only it offers a marker.
      expect(foldMarkers(editors[0] as Element)).toHaveLength(0);
      expect(foldMarkers(editors[1] as Element)).toHaveLength(1);
    } finally {
      handle.destroy();
      element.remove();
    }
  });
});
