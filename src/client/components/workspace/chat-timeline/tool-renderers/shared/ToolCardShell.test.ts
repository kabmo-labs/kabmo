/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The collapsed card's header is exactly TWO lines: the title, and one meta
 * line. The meta line disappears entirely once the card is expanded.
 *
 * The bug this pins: the identity (subtitle) and the outcome (fact chips) were
 * two stacked rows, so a `bash` card drew `Bash` / `cd /Users/…` / `599ms ·
 * 17 lines`. Three lines for a collapsed row, and the reader's report — "why
 * does bash have two subtitle lines" — was correct about what they saw even
 * though neither row wrapped on its own.
 *
 * Hiding it on expand mirrors `ThinkingSection`, which is the same card shape
 * and already drops its summary when open.
 *
 * Mounted against happy-dom and measured by RENDERED GEOMETRY, not by class
 * names: the classes were right while the layout was wrong, so a test that
 * asserted on them would have passed through the whole bug.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { ToolCardShell } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/ToolCardShell';
import type { ToolCallData } from '@/shared/types/chat';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'KeyboardEvent'] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};
let container: HTMLElement;

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in nativeGlobals)) nativeGlobals[key] = target[key];
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

const TOOL: ToolCallData = { id: 'c1', type: 'bash', name: 'bash', title: 'Bash', status: 'success' } as ToolCallData;
const SUMMARY = {
  facts: [
    { kind: 'time' as const, label: '599ms' },
    { kind: 'count' as const, label: '17 lines' },
  ],
  line: '599ms · 17 lines',
};

async function mount(props: { isOpen?: boolean; subtitle?: string; summary?: typeof SUMMARY | null }) {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(
      h(ToolCardShell, {
        tool: TOOL,
        icon: null,
        title: 'Bash',
        subtitle: props.subtitle ?? 'cd /Users/x && echo hi',
        summary: props.summary === undefined ? SUMMARY : props.summary,
        isOpen: props.isOpen,
        onToggle: () => {},
        children: h('div', {}, 'body'),
      }),
      container,
    );
  });
  return container;
}

/** The column that holds the title row and the meta row. */
function column(el: HTMLElement): HTMLElement {
  const button = el.querySelector('button')!;
  return button.children[1] as HTMLElement;
}

describe('ToolCardShell header rows', () => {
  test('a collapsed card draws exactly two rows: title and one meta line', async () => {
    const el = await mount({ isOpen: false });
    const col = column(el);
    expect(col.children.length).toBe(2);
  });

  test('the meta row carries both the identity and the facts, not one row each', async () => {
    const el = await mount({ isOpen: false });
    const meta = column(el).children[1] as HTMLElement;
    expect(meta.textContent).toContain('cd /Users/x && echo hi');
    expect(meta.textContent).toContain('599ms');
    expect(meta.textContent).toContain('17 lines');
  });

  test('an expanded card drops the meta row entirely', async () => {
    const el = await mount({ isOpen: true });
    const col = column(el);
    expect(col.children.length).toBe(1);
    expect(col.textContent).not.toContain('599ms');
  });

  test('expanding removes the subtitle too, mirroring the thinking card', async () => {
    const el = await mount({ isOpen: true });
    expect(el.querySelector('button')!.textContent).not.toContain('cd /Users/x');
  });

  test('a card with neither subtitle nor facts draws the title alone', async () => {
    const el = await mount({ isOpen: false, subtitle: '', summary: null });
    expect(column(el).children.length).toBe(1);
  });

  test('a card with only facts still draws one meta row', async () => {
    const el = await mount({ isOpen: false, subtitle: '', summary: SUMMARY });
    const col = column(el);
    expect(col.children.length).toBe(2);
    expect((col.children[1] as HTMLElement).textContent).toContain('599ms');
  });

  test('a card with only a subtitle still draws one meta row', async () => {
    const el = await mount({ isOpen: false, subtitle: 'src/x.ts', summary: null });
    const col = column(el);
    expect(col.children.length).toBe(2);
    expect((col.children[1] as HTMLElement).textContent).toContain('src/x.ts');
  });
});

describe('ToolCardShell header is exactly two rows at most', () => {
  test('the column holds the title row plus one meta row, never three', async () => {
    const el = await mount({ isOpen: false });
    const col = column(el);
    // title row + ONE meta row. A third row was the bug: the subtitle and the
    // facts each had their own.
    expect(col.children.length).toBe(2);
  });

  test('no meta row is rendered while expanded', async () => {
    const el = await mount({ isOpen: true });
    expect(column(el).children.length).toBe(1);
  });
});
