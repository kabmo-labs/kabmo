/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The shared numbered code block, and the invariants every gutter in the
 * timeline now inherits from it.
 *
 * The defect it exists for was reported from a live transcript: **the numbers
 * drifted off the code.** Six panels each stated their own line box, and three
 * had drifted. `JsonCodeBlock` was the worst — the gutter was `text-[10px]`
 * under the code's `text-[11px]`, both inheriting `leading-relaxed`, a RATIO,
 * so the row boxes were 16.25px against 17.875px and by line 20 the number sat
 * **30.9px** above the code it labels (measured in Chromium). `ExcerptCode` was
 * a constant −1px for the same reason (a smaller face under the same box), and
 * `Edit`'s write preview drew one MORE number than it had lines.
 *
 * These cases pin the properties that make those impossible, and they are
 * stated on the rendered DOM rather than on the class list: a class-list
 * assertion is what let `Eval`'s own test pass while `JsonCodeBlock` — the
 * surface behind the Bash console, the eval result and the card's input JSON —
 * carried the same bug.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { NumberedCode } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/numbered-code';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event', 'MouseEvent', 'KeyboardEvent'] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

let container: HTMLElement;

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (nativeGlobals[key] === undefined) delete target[key];
    else target[key] = nativeGlobals[key];
  }
});

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

interface Mounted {
  root: HTMLElement;
  gutter: HTMLElement;
  code: HTMLElement;
}

function mount(props: Partial<Parameters<typeof NumberedCode>[0]> = {}): Mounted {
  const numbers = props.numbers ?? [1, 2, 3];
  const lines = props.lines ?? ['const a = 1;', 'const b = 2;', 'const c = 3;'];
  act(() => {
    render(h(NumberedCode, { numbers, lines, ...props }), container);
  });
  const gutter = container.querySelector('div[aria-hidden="true"]') as HTMLElement;
  const code = gutter?.nextElementSibling as HTMLElement;
  if (!gutter || !code) throw new Error('NumberedCode did not render both columns');
  return { root: container, gutter, code };
}

/** The inline line box a column's rows carry. */
function boxOf(column: HTMLElement): { height: string; lineHeight: string; fontSize: string } {
  const row = column.firstElementChild as HTMLElement;
  return {
    height: row.style.height,
    lineHeight: row.style.lineHeight,
    fontSize: row.style.fontSize,
  };
}

describe('NumberedCode — the two columns share one line box', () => {
  test('both columns carry the same explicit box and font size', () => {
    // The whole defect in one assertion: a RATIO line-height resolved against
    // two font sizes gives two boxes, and a smaller face under one box gives
    // two baselines. Neither can happen when both sides read the same values.
    const { gutter, code } = mount();
    expect(boxOf(gutter)).toEqual(boxOf(code));
    expect(boxOf(gutter)).toEqual({ height: '20px', lineHeight: '20px', fontSize: '11px' });
  });

  test('the box is inline style, not a class a build could drop', () => {
    // `leading-[20px]` and `h-[20px]` are arbitrary-value utilities: a class the
    // CSS generator did not emit fails silently, and the row then takes its
    // height from whatever line-height it inherits — the original bug's shape.
    const { gutter, code } = mount();
    for (const column of [gutter, code]) {
      const row = column.firstElementChild as HTMLElement;
      expect(row.getAttribute('style')).toContain('height');
      expect(row.className).not.toContain('h-[20px]');
      expect(row.className).not.toContain('leading-[20px]');
    }
  });

  test('a caller can move the box, and both sides follow', () => {
    const { gutter, code } = mount({ lineHeight: 18, fontSize: 11 });
    expect(boxOf(gutter)).toEqual({ height: '18px', lineHeight: '18px', fontSize: '11px' });
    expect(boxOf(code)).toEqual(boxOf(gutter));
  });
});

describe('NumberedCode — the row counts cannot disagree', () => {
  test('one row per number, one row per line', () => {
    const { gutter, code } = mount({ numbers: [10, 11, 12, 13], lines: ['a', 'b', 'c', 'd'] });
    expect(gutter.children).toHaveLength(4);
    expect(code.children).toHaveLength(4);
  });

  test('a blank line still gets its own code row', () => {
    // The bug this replaces drew the code as ONE `<pre>` with `<br>` separators:
    // a blank line between two separators produced no element, and a highlight
    // that returned nothing for it shortened the text side only.
    const { gutter, code } = mount({ numbers: [1, 2, 3], lines: ['a', '', 'c'] });
    expect(code.children).toHaveLength(3);
    expect(gutter.children).toHaveLength(3);
  });

  test('a missing highlight fragment renders an empty row rather than nothing', () => {
    const { gutter, code } = mount({ numbers: [1, 2, 3], lines: ['a'] });
    expect(code.children).toHaveLength(1);
    expect(gutter.children).toHaveLength(3);
  });
});

describe('NumberedCode — the gutter is not content', () => {
  test('the gutter is hidden from assistive tech and cannot be selected', () => {
    const { gutter } = mount();
    expect(gutter.getAttribute('aria-hidden')).toBe('true');
    expect(gutter.className).toContain('select-none');
  });

  test('a number and an ellipsis marker both render as gutter rows', () => {
    // `Edit`'s write preview marks its truncation with a `…` row. It used to be
    // a gutter-only row: 81 numbers beside 80 lines, so every number past the
    // marker sat a line above its code.
    const { gutter } = mount({ numbers: [1, 2, '…'], lines: ['a', 'b', ''] });
    expect(Array.from(gutter.children).map((row) => row.textContent)).toEqual(['1', '2', '…']);
  });
});
