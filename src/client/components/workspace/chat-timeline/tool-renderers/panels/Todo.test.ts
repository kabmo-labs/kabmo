/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `todo` tool card's body.
 *
 * The parser is covered by `shared/lib/chat/todo/parser.test.ts`; what this
 * pins is the RENDER — that a task whose content is a stringified init-list
 * entry is drawn as the phase it names (with its items listed beneath) and
 * never as raw JSON, and that the two statuses the card never used to know
 * (`blocked`, `abandoned`) get their own icon and note instead of the pending
 * circle.
 *
 * Rendered with `h()` (no JSX) against happy-dom, following the harness in
 * `mobile-session-sidebar/SessionRow.test.ts`.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { Todo } from '@/client/components/workspace/chat-timeline/tool-renderers/panels/Todo';
import type { ToolCallData } from '@/shared/types';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'KeyboardEvent'] as const;
/** The runner's own globals, restored on teardown — deleting them would strip natives (Event/CustomEvent) every later file needs. */const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

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

async function mount(tool: Partial<ToolCallData>) {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(h(Todo, { tool: { id: 'c1', type: 'todo', name: 'todo', title: 'todo', ...tool } as ToolCallData }), container);
  });
  return container;
}

describe('Todo card', () => {
  test('draws a nested init-list task as its phase, not as JSON', async () => {
    const el = await mount({
      input: { op: 'init', items: [{ phase: 'Fondasi auth server', items: ['paths.ts: getAuthPath()'] }] },
      output: [
        'Remaining items (1):',
        '  - {"phase":"Fondasi auth server","items":["paths.ts: getAuthPath()"]} [in_progress] (Tasks)',
        'Overall: 0/1 done, 1 open.',
        '  Tasks:',
        '    - [ ] {"phase":"Fondasi auth server","items":["paths.ts: getAuthPath()"]} (in progress)',
      ].join('\n'),
      status: 'success',
    });

    const text = el.textContent ?? '';
    expect(text).toContain('Fondasi auth server');
    expect(text).toContain('paths.ts: getAuthPath()');
    expect(text).not.toContain('{"phase"');
    expect(text).not.toContain('items\\":');
  });

  test('gives a blocked task its own icon and blocker note', async () => {
    const el = await mount({
      input: { op: 'view' },
      output: [
        'Overall: 0/1 done, 1 open, 1 blocked.',
        '  Tasks:',
        '    - [ ] needs a credential (blocked: no API key)',
      ].join('\n'),
      status: 'success',
    });

    const classes = Array.from(el.querySelectorAll('svg')).map((s) => s.getAttribute('class') ?? '').join('|');
    expect(classes).toContain('lucide-octagon-alert');
    expect(classes).not.toContain('lucide-circle');
    expect(el.textContent).toContain('no API key');
  });

  test('strikes through and checks an abandoned task', async () => {
    const el = await mount({
      input: { op: 'drop', task: 'old plan' },
      output: ['Overall: 1/1 done, 0 open.', '  Tasks:', '    - [ ] old plan (dropped)'].join('\n'),
      status: 'success',
    });

    const classes = Array.from(el.querySelectorAll('svg')).map((s) => s.getAttribute('class') ?? '').join('|');
    expect(classes).toContain('lucide-ban');
    const struck = Array.from(el.querySelectorAll('div')).some((d) => (d.className ?? '').includes('line-through'));
    expect(struck).toBe(true);
  });

  test('reports closed over total, so a dropped task still counts as settled', async () => {
    const el = await mount({
      input: { op: 'drop', task: 'old plan' },
      output: ['Overall: 1/1 done, 0 open.', '  Tasks:', '    - [ ] old plan (dropped)'].join('\n'),
      status: 'success',
    });

    expect(el.textContent).toContain('1 of 1 done');
    expect(el.textContent).toContain('100%');
  });
});
