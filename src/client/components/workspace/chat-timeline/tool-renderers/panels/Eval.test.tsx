/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The `eval` card body.
 *
 * The alignment defect is pinned here as it was reported from a live
 * transcript — **the gutter numbers drifted off the code** — and the fix moved
 * the line box out of this file entirely: both numbered blocks draw through
 * `NumberedCode`, which states one px box and one font size for both columns.
 * The earlier version of this file asserted the two sides carried the same
 * `leading-[…]` class, which passed while `JsonCodeBlock` — the surface behind
 * the Bash console, the eval RESULT and the card's input JSON — kept the same
 * bug at 30.9px of drift by line 20. So the assertions here are about the
 * rendered box, and the general invariants live in `shared/numbered-code.test.tsx`.
 *
 * The result cases cover the OTHER half of the same report ("output does not
 * render while streaming"): the panel does read `tool.output` as it arrives, so
 * what made a live eval look empty was the card being folded — pinned in
 * `hooks/chat/timeline/tool-open.test.ts`, where a running eval opens itself.
 *
 * Rendered with `h()` against happy-dom, following `panels/Read.test.ts`.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { Eval } from '@/client/components/workspace/chat-timeline/tool-renderers/panels/Eval';
import type { ToolCallData } from '@/shared/types';

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

function mount(tool: ToolCallData): HTMLElement {
  act(() => {
    render(h(Eval, { tool }), container);
  });
  return container;
}

const CODE = ['const a = 1;', 'const b = 2;', 'console.log(a + b);'].join('\n');

function evalTool(overrides: Partial<ToolCallData> = {}): ToolCallData {
  return {
    id: 'call_1',
    type: 'eval',
    name: 'eval',
    title: 'Sum two numbers',
    input: { language: 'js', code: CODE },
    status: 'running',
    ...overrides,
  } as ToolCallData;
}

/** The inline line box a column's rows carry. */
function boxOf(column: Element): { height: string; lineHeight: string; fontSize: string } {
  const row = column.firstElementChild as HTMLElement;
  return { height: row.style.height, lineHeight: row.style.lineHeight, fontSize: row.style.fontSize };
}

/** The code card: the gutter/pre pair whose code column holds the SCRIPT. */
function codeCard(root: HTMLElement): { gutter: Element; code: Element } {
  const gutter = root.querySelectorAll('div[aria-hidden="true"]')[0];
  const code = gutter?.nextElementSibling;
  if (!gutter || !code) throw new Error('code card not rendered');
  return { gutter, code };
}

describe('Eval — result rendering', () => {
  test('a running call renders the output it has so far', () => {
    // omp's `tool_execution_update` carries the cell's output SO FAR, and the
    // panel reads it from `tool.output` — which is what the fold writes from
    // the frame's `content`. Verified against a real omp run: `content` and
    // `details.cells[].output` are byte-identical on every update frame.
    const root = mount(evalTool({ output: 'live 1\nlive 2' }));
    const text = root.textContent ?? '';
    expect(text).toContain('live 1');
    expect(text).toContain('live 2');
  });

  test('renders only the script while a running call has produced nothing yet', () => {
    const root = mount(evalTool({ output: '' }));
    expect(root.querySelectorAll('div[aria-hidden="true"]')).toHaveLength(1);
    expect(root.textContent).toContain('Script Evaluation');
  });
});

describe('Eval — gutter aligns with the code', () => {
  test('the gutter and the code share one line box', () => {
    const { gutter, code } = codeCard(mount(evalTool()));
    // The bug: an inherited RATIO (`leading-relaxed`) resolved against two
    // different font sizes, so the boxes differed by 1.625px per line. An
    // explicit box on both sides is the fix, and it has to be EXPLICIT: two
    // inherited ratios agree while two font sizes do not.
    expect(boxOf(gutter).height).not.toBe('');
    expect(boxOf(gutter)).toEqual(boxOf(code));
  });

  test('one gutter row per code line', () => {
    const { gutter, code } = codeCard(mount(evalTool()));
    expect(gutter.children).toHaveLength(CODE.split('\n').length);
    expect(code.children).toHaveLength(CODE.split('\n').length);
  });

  test('the JSON result block aligns the same way', () => {
    // The pretty-printed result draws its own gutter, and it had the same
    // mismatch (plus a `py-2` against the code's `p-2.5`).
    const root = mount(evalTool({ output: '{"a": 1, "b": [2, 3]}', status: 'success' }));
    const gutters = root.querySelectorAll('div[aria-hidden="true"]');
    const jsonGutter = gutters[1];
    expect(jsonGutter).toBeDefined();
    const code = jsonGutter.nextElementSibling as Element;
    expect(code).not.toBeNull();
    expect(boxOf(jsonGutter)).toEqual(boxOf(code));
    // `{"a": 1, "b": [2, 3]}` pretty-prints to 7 lines.
    expect(jsonGutter.children).toHaveLength(7);
    expect(code.children).toHaveLength(7);
  });
});
