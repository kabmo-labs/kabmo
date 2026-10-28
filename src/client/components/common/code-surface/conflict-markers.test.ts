/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Conflict markers: what is painted, and what is counted.
 *
 * Both halves have a way of looking right while being wrong:
 *
 * - A decorator whose regexp is not anchored to a line start also paints the
 *   `<<<<<<<` inside a string, which is the one place a marker is NOT a conflict.
 * - `countConflicts` counting every occurrence would report a conflict for a
 *   file that merely mentions the marker in its own documentation — including
 *   this repository's wiki.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import { conflictMarkers, countConflicts } from '@/client/components/common/code-surface/conflict-markers';
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

/** The classes the plugin painted, by line number, with the line's own text. */
function paintedLines(doc: string): Array<{ line: number; classes: string[]; text: string }> {
  const view = new EditorView({
    parent: host,
    state: EditorState.create({ doc, extensions: [conflictMarkers()] }),
  });
  const lines = Array.from(view.contentDOM.querySelectorAll('.cm-line'));
  const painted = lines.map((element, index) => ({
    line: index + 1,
    classes: Array.from(element.classList).filter((name) => name.startsWith('cm-conflict-')),
    text: element.textContent ?? '',
  }));
  view.destroy();
  return painted.filter((entry) => entry.classes.length > 0);
}

const CONFLICT = [
  'before();',
  '<<<<<<< HEAD',
  'ours();',
  '=======',
  'theirs();',
  '>>>>>>> feature/x',
  'after();',
].join('\n');

describe('conflictMarkers', () => {
  test('paints ours, the base section and theirs, and leaves the separator alone', () => {
    const doc = ['<<<<<<< HEAD', 'ours();', '||||||| base', 'base();', '=======', 'theirs();', '>>>>>>> x'].join('\n');
    expect(paintedLines(doc)).toEqual([
      { line: 1, classes: ['cm-conflict-ours'], text: '<<<<<<< HEAD' },
      { line: 3, classes: ['cm-conflict-base'], text: '||||||| base' },
      { line: 7, classes: ['cm-conflict-theirs'], text: '>>>>>>> x' },
    ]);
  });

  test('the marker text is still rendered, not swallowed by the band', () => {
    // The regression this pins: a line decoration added over the MATCHED RANGE
    // (`MatchDecorator`'s shape) rendered the marker lines as blank rows while
    // the document still held their text. A band is a decoration on an empty
    // range at the line's start; anything else eats the content.
    const painted = paintedLines(CONFLICT);
    expect(painted.map((entry) => entry.text)).toEqual(['<<<<<<< HEAD', '>>>>>>> feature/x']);
  });

  test('a marker inside a line is not a marker', () => {
    // A string literal and a comment are the two ways a file mentions the
    // sequence without being conflicted.
    const doc = ['const a = "<<<<<<< HEAD";', '// >>>>>>> not a marker either', 'plain();'].join('\n');
    expect(paintedLines(doc)).toEqual([]);
  });

  test('a marker with no label still paints', () => {
    expect(paintedLines('<<<<<<<\na\n>>>>>>>')).toEqual([
      { line: 1, classes: ['cm-conflict-ours'], text: '<<<<<<<' },
      { line: 3, classes: ['cm-conflict-theirs'], text: '>>>>>>>' },
    ]);
  });

  test('an unconflicted file paints nothing', () => {
    expect(paintedLines('function f() {\n  return 1;\n}\n')).toEqual([]);
  });
});

describe('countConflicts', () => {
  test('counts one block per opening marker', () => {
    expect(countConflicts(CONFLICT)).toBe(1);
    expect(countConflicts(`${CONFLICT}\n${CONFLICT}`)).toBe(2);
  });

  test('a file with no conflict is zero', () => {
    expect(countConflicts('')).toBe(0);
    expect(countConflicts('a();\nb();\n')).toBe(0);
  });

  test('a mention mid-line is not a block', () => {
    // The distinction the whole feature rests on: the marker is a LINE.
    expect(countConflicts('const m = "<<<<<<< HEAD";')).toBe(0);
    expect(countConflicts('see <<<<<<< in the docs\n')).toBe(0);
  });

  test('a marker at the very start of the file counts', () => {
    expect(countConflicts('<<<<<<< HEAD\n')).toBe(1);
  });
});
