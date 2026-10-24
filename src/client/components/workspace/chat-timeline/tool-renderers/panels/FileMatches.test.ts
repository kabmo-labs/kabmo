/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * One file's matches inside a `grep` card.
 *
 * The card used to mount every line of every file group inside a `max-h-80`
 * scroller, and tokenize them all in one pass. Two properties are pinned here,
 * because both were the measured cost of expanding the card:
 *
 * 1. **A file group mounts a bounded number of rows**, with the rest one click
 *    away — `MAX_OUTPUT_LINES` caps the whole output, so a single 900-line group
 *    used to draw 900 rows to show ~14.
 * 2. **The rows that ARE mounted carry their line numbers and text from the
 *    first paint**, before the deferred highlight lands.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { FileMatches, MAX_MATCH_LINES_PER_FILE } from '@/client/components/workspace/chat-timeline/tool-renderers/panels/FileMatches';
import { clearHighlightMemo } from '@/shared/lib/code/highlight-memo';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event', 'MouseEvent'] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};
let container: HTMLElement;

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (nativeGlobals[key] === undefined) delete target[key];
    else target[key] = nativeGlobals[key];
  }
});

beforeEach(() => {
  clearHighlightMemo();
  // A fresh root per test: `render` keeps its vnode tree on the element it was
  // given, so clearing the markup in place would leave preact diffing against a
  // tree that is no longer there and skip the render entirely.
  container = document.createElement('div');
  document.body.appendChild(container);
});

/** Rows the card drew, counted by the gutter numbers it printed. */
function rowCount(el: HTMLElement): number {
  return el.querySelectorAll('pre.shiki').length;
}

function matches(total: number) {
  return Array.from({ length: total }, (_, index) => ({
    lineNum: index + 1,
    text: `const value${index} = ${index};`,
    isMatch: index % 5 === 0,
  }));
}

describe('FileMatches', () => {
  test('mounts a bounded number of rows for a long file group', async () => {
    await act(async () => {
      render(h(FileMatches, { path: 'src/a.ts', lines: matches(300), matchCount: 60, isGlobList: false }), container);
    });

    expect(rowCount(container)).toBe(MAX_MATCH_LINES_PER_FILE);
    expect(container.textContent).toContain('const value0 = 0;');
    expect(container.textContent).not.toContain('const value299 = 299;');
  });

  test('offers the hidden rows, and reveals every one of them', async () => {
    await act(async () => {
      render(h(FileMatches, { path: 'src/a.ts', lines: matches(300), matchCount: 60, isGlobList: false }), container);
    });
    const reveal = Array.from(container.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes('show all'));
    expect(reveal).toBeDefined();
    expect(reveal?.textContent).toContain('240');

    await act(async () => {
      reveal?.click();
    });
    expect(rowCount(container)).toBe(300);
  });

  test('a short group draws no reveal control at all', async () => {
    await act(async () => {
      render(h(FileMatches, { path: 'src/a.ts', lines: matches(4), matchCount: 1, isGlobList: false }), container);
    });
    expect(rowCount(container)).toBe(4);
    expect(container.textContent).not.toContain('show all');
  });

  test('the first paint carries the text, before any highlight is computed', async () => {
    await act(async () => {
      render(h(FileMatches, { path: 'src/a.ts', lines: matches(3), matchCount: 1, isGlobList: false }), container);
    });
    // Nothing tokenized yet, and the rows still read correctly.
    expect(container.textContent).toContain('const value2 = 2;');
    expect(container.querySelectorAll('pre.shiki')).toHaveLength(3);
  });
});
