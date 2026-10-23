/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The `eval` card body.
 *
 * The alignment defect is pinned here, and it was reported from a live
 * transcript rather than found by reading the code: **the gutter numbers
 * drifted off the code.** The gutter row was `text-[10px]` while the code was
 * `text-[11px]`, and both inherited `leading-relaxed` — a ratio, so the row box
 * was 16.25px against the code's 17.875px and every number sat higher than its
 * line by a growing amount (measured after a reload: line 12's number was a
 * full line above its code). The two sides now share one explicit line box,
 * which is what the alignment case asserts — by comparing the two elements' own
 * leading class, so a future edit that changes one side is caught instead of
 * copied.
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

/** The `leading-[…]` token a node carries, or null. */
function leadingOf(el: Element): string | null {
  return /(?:^|\s)(leading-\[\d+px\])/.exec(el.className)?.[1] ?? null;
}

/** The code card: the gutter/pre pair whose pre holds the SCRIPT. */
function codeCard(root: HTMLElement): { gutter: Element; pre: Element } {
  const gutter = root.querySelectorAll('.sticky')[0];
  const pre = gutter?.parentElement?.querySelector('pre');
  if (!gutter || !pre) throw new Error('code card not rendered');
  return { gutter, pre };
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
    expect(root.querySelectorAll('pre')).toHaveLength(1);
    expect(root.textContent).toContain('Script Evaluation');
  });
});

describe('Eval — gutter aligns with the code', () => {
  test('the gutter and the code share one line box', () => {
    const { gutter, pre } = codeCard(mount(evalTool()));
    const gutterLeading = leadingOf(gutter);
    expect(gutterLeading).not.toBeNull();
    // The bug: an inherited RATIO (`leading-relaxed`) resolved against two
    // different font sizes, so the boxes differed by 1.625px per line.
    expect(leadingOf(pre)).toBe(gutterLeading);
  });

  test('one gutter row per code line', () => {
    const { gutter } = codeCard(mount(evalTool()));
    expect(gutter.children).toHaveLength(CODE.split('\n').length);
  });

  test('the JSON result block aligns the same way', () => {
    // The pretty-printed result draws its own gutter, and it had the same
    // mismatch (plus a `py-2` against the code's `p-2.5`).
    const root = mount(evalTool({ output: '{"a": 1, "b": [2, 3]}', status: 'success' }));
    const gutters = root.querySelectorAll('.sticky');
    const jsonGutter = gutters[1];
    expect(jsonGutter).toBeDefined();
    const pre = jsonGutter.parentElement?.querySelector('pre');
    expect(pre).not.toBeNull();
    // Explicit on BOTH, not merely equal: `null === null` would pass while both
    // sides inherit a ratio against different font sizes, which is the bug.
    expect(leadingOf(jsonGutter)).not.toBeNull();
    expect(leadingOf(pre as Element)).toBe(leadingOf(jsonGutter));
    // `{"a": 1, "b": [2, 3]}` pretty-prints to 7 lines.
    expect(jsonGutter.children).toHaveLength(7);
  });
});
