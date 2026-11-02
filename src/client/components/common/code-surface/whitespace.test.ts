/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Whitespace marks, through the REAL surface stack.
 *
 * Pins what makes this feature different from both alternatives, and each case
 * is one a naive version gets wrong:
 *
 * - **A bare caret paints nothing.** The package's `highlightWhitespace()` marks
 *   every space in the viewport and a leading-run version marks every block's
 *   indentation; both look identical to this one as soon as text is selected,
 *   so the CARET case is the only one that tells them apart.
 * - **Only the selected characters are marked**, so a selection that stops
 *   mid-line marks the part it covers and nothing past it.
 * - **Collapsing the selection clears the marks.** They are a function of the
 *   selection, so a missing rebuild leaves the last painted set on screen.
 *
 * The marks exist only once a view mounts (a `ViewPlugin`), which is why every
 * case here mounts one; `whitespaceDecorations` is also driven directly, so the
 * rules are asserted without depending on the DOM.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import { surfaceExtensions } from '@/client/components/common/code-surface/extensions';
import { whitespaceDecorations } from '@/client/components/common/code-surface/whitespace';
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

/** The component's own stack, mounted at `selection` (offsets into `doc`). */
function mount(doc: string, selection?: { anchor: number; head: number }): EditorView {
  return new EditorView({
    parent: host,
    state: EditorState.create({
      doc,
      selection,
      extensions: surfaceExtensions({
        language: 'typescript',
        wordWrapCompartment: new Compartment(),
        readOnlyCompartment: new Compartment(),
        themeCompartment: new Compartment(),
        languageCompartment: new Compartment(),
        indentCompartment: new Compartment(),
        typingCompartment: new Compartment(),
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
    }),
  });
}

/** The mark classes on each rendered line, in document order. */
function marksByLine(view: EditorView): Array<{ text: string; marks: string[] }> {
  return Array.from(view.contentDOM.querySelectorAll('.cm-line')).map((line) => ({
    text: line.textContent ?? '',
    marks: Array.from(line.querySelectorAll('.cm-whitespace-space, .cm-whitespace-tab')).map((mark) => mark.className),
  }));
}

/** Every marked range of a document, without mounting a view. */
function ranges(doc: string, selection?: { anchor: number; head: number }): Array<[number, number]> {
  const state = EditorState.create({ doc, selection });
  const out: Array<[number, number]> = [];
  whitespaceDecorations(state).between(0, state.doc.length, (from, to) => {
    out.push([from, to]);
  });
  return out;
}

describe('whitespace marks', () => {
  test('a caret paints nothing, however much whitespace the file holds', () => {
    const doc = 'function f() {\n    const a = 1;\n}\n';
    const view = mount(doc, { anchor: 0, head: 0 });
    expect(marksByLine(view).flatMap((line) => line.marks)).toEqual([]);
    // And the rule agrees without a view.
    expect(ranges(doc)).toEqual([]);
    view.destroy();
  });

  test('a selection marks every space it covers, indent and between tokens alike', () => {
    const doc = 'function f() {\n    const a = 1;\n}\n';
    const lineFrom = doc.indexOf('    const');
    const view = mount(doc, { anchor: lineFrom, head: lineFrom + '    const a = 1;'.length });
    const block = marksByLine(view).find((line) => line.text === '    const a = 1;');
    view.destroy();

    // Four of indent plus the three between `const`, `a`, `=` and `1`: inside a
    // selection, EVERY space is the point — that is what the reader is counting.
    expect(block?.marks).toEqual(Array(7).fill('cm-whitespace-space'));
  });

  test('a selection that stops mid-line marks only the part it covers', () => {
    expect(ranges('   x\n', { anchor: 0, head: 2 })).toEqual([
      [0, 1],
      [1, 2],
    ]);
    expect(ranges('   x\n', { anchor: 1, head: 3 })).toEqual([
      [1, 2],
      [2, 3],
    ]);
  });

  test('a tab in the selection is one arrow, not the columns it measures', () => {
    const view = mount('\tif (a) {\n', { anchor: 0, head: 6 });
    expect(marksByLine(view)[0].marks).toEqual(['cm-whitespace-tab', 'cm-whitespace-space']);
    view.destroy();
  });

  test('a selection spanning several lines marks each covered line', () => {
    const doc = '  a\n    b\nc\n';
    expect(ranges(doc, { anchor: 0, head: doc.length })).toEqual([
      [0, 1],
      [1, 2],
      [4, 5],
      [5, 6],
      [6, 7],
      [7, 8],
    ]);
  });

  test('a selection ending in a line break does not reach the next line', () => {
    // `    b` is fully covered; `c` starts at offset 9 and must not be touched.
    const doc = '  a\n    b\nc\n';
    expect(ranges(doc, { anchor: 4, head: 9 })).toEqual([
      [4, 5],
      [5, 6],
      [6, 7],
      [7, 8],
    ]);
  });

  test('collapsing the selection clears the marks instead of leaving them painted', () => {
    const doc = '  a\n    b\n';
    const view = mount(doc, { anchor: 0, head: doc.length });
    expect(marksByLine(view).flatMap((line) => line.marks).length).toBe(6);

    view.dispatch({ selection: { anchor: 3, head: 3 } });
    expect(marksByLine(view).flatMap((line) => line.marks)).toEqual([]);
    view.destroy();
  });

  test('the mark holds the character it replaces, so a copy keeps its whitespace', () => {
    const view = mount('    x\n', { anchor: 0, head: 4 });
    const mark = view.contentDOM.querySelector('.cm-whitespace-space');
    expect(mark?.textContent).toBe(' ');
    expect(view.contentDOM.querySelector('.cm-line')?.textContent).toBe('    x');
    view.destroy();
  });

  test('the window bounds the walk, so a whole-document selection is still cheap', () => {
    // The window is the viewport in the plugin; here it stands in for one, and the
    // answer must be the selection INTERSECTED with it — not the whole document.
    const doc = '  a\n  b\n  c\n';
    const state = EditorState.create({ doc, selection: { anchor: 0, head: doc.length } });
    const out: Array<[number, number]> = [];
    whitespaceDecorations(state, state.selection.ranges, { from: 4, to: 8 }).between(0, state.doc.length, (from, to) => {
      out.push([from, to]);
    });
    // Line 2's two spaces; the newline at 7 and line 3 (from offset 8) are outside
    // the window, so they cost nothing.
    expect(out).toEqual([
      [4, 5],
      [5, 6],
    ]);
  });
});

describe('whitespace theme', () => {
  test('both marks paint from the surface ink, and no indent guide survives', () => {
    const view = mount('  a\n', { anchor: 0, head: 3 });
    const css = Array.from(document.head.querySelectorAll('style'))
      .map((node) => node.textContent ?? '')
      .join('\n');
    view.destroy();

    // The package's own `#aaa`/`#888` are chroma the palette does not own, and
    // they disappear against a dark editor theme, so both marks restate the ink.
    expect(css).toMatch(/\.cm-whitespace-space \{[^}]*var\(--editor-fg, var\(--theme-ink\)\)/);
    expect(css).toMatch(/\.cm-whitespace-tab \{[^}]*var\(--editor-fg, var\(--theme-ink\)\)/);
    // One dot per character box, which is what `.4em` with `no-repeat` gives.
    expect(css).toMatch(/\.cm-whitespace-space \{[^}]*background-size: \.4em/);
    // The per-level vertical rule is gone; the marks replaced it.
    expect(css).not.toContain('.cm-indent-guide');
  });
});
