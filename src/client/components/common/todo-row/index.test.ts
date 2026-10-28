/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The shared todo row, as the right-panel view hands it a task.
 *
 * The chat card's parser labels a nested init-list task before the row sees it
 * (content = the phase name, items in `notes`). The right-panel Todo view does
 * NOT: it renders omp's snapshot verbatim, so the content is still the raw
 * JSON blob. Both producers reach this one component, and a row that only knew
 * the labelled shape drew the blob on the panel — the exact defect the card was
 * fixed for, reappearing on the other surface.
 *
 * Rendered with `h()` (no JSX) against happy-dom.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { TodoRow } from '@/client/components/common/todo-row';
import type { TodoItem } from '@/shared/types/todo';

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

async function mount(task: TodoItem, current = false) {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(h(TodoRow, { task, current }), container);
  });
  return container;
}

const BLOB = '{"phase":"Fondasi auth server","items":["paths.ts: getAuthPath()","auth/config.ts: hash"]}';

describe('TodoRow', () => {
  test('labels a raw nested blob as its phase and lists the encoded items', async () => {
    const el = await mount({ content: BLOB, status: 'in_progress' });

    expect(el.textContent).toContain('Fondasi auth server');
    expect(el.textContent).toContain('paths.ts: getAuthPath()');
    expect(el.textContent).not.toContain('{"phase"');
  });

  test('prefers the parser-supplied label over re-parsing the content', async () => {
    const el = await mount({
      content: 'Fondasi auth server',
      status: 'pending',
      notes: ['paths.ts: getAuthPath()'],
    });

    expect(el.textContent).toContain('Fondasi auth server');
    expect(el.textContent).toContain('paths.ts: getAuthPath()');
  });

  test('draws a blocked row with its own icon and note', async () => {
    const el = await mount({ content: 'needs a credential', status: 'blocked', blocker: 'no API key' });

    const classes = Array.from(el.querySelectorAll('svg')).map((s) => s.getAttribute('class') ?? '').join('|');
    expect(classes).toContain('lucide-octagon-alert');
    expect(el.textContent).toContain('no API key');
  });

  test('marks the current row without inventing one', async () => {
    const el = await mount({ content: 'ship it', status: 'in_progress' }, true);
    expect(el.textContent).toContain('Now');
  });
});
