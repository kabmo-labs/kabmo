/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The chip the reader actually clicks.
 *
 * The detector and the opener are tested on their own; this pins the wiring
 * between them — that the chat pipeline marks the span, that a click (and
 * Enter) reaches the editor, that a finished text selection does not open a
 * tab, and that a document preview keeps its own link rule instead of getting
 * the chat one.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { MarkdownRenderer } from '@/client/components/common/MarkdownRenderer';
import { setPluginContext } from '@/client/lib/plugins/context';

const DOM_GLOBALS = [
  'window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement',
  'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'MutationObserver',
] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

let win: Window;
let opened: Array<{ path: string; root?: string }> = [];
let container: HTMLElement;

beforeAll(() => {
  win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
  win.addEventListener('omp:open-file', (event) => {
    opened.push((event as unknown as CustomEvent<{ path: string; root?: string }>).detail);
  });
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (nativeGlobals[key] === undefined) delete target[key];
    else target[key] = nativeGlobals[key];
  }
});

afterEach(() => {
  render(null, container);
  container.remove();
  opened = [];
  setPluginContext(null, null);
});

function mount(content: string, options: { document?: boolean; sessionId?: string } = {}): HTMLElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  setPluginContext(options.sessionId ?? null, '/repo');
  act(() => {
    render(
      <MarkdownRenderer
        content={content}
        sessionId={options.sessionId}
        document={options.document}
        {...(options.document ? { scope: { path: 'README.md', root: '/repo' } } : {})}
      />,
      container,
    );
  });
  return container;
}

describe('inline file chips in the chat timeline', () => {
  test('a path span is marked, and a click opens the file', () => {
    const host = mount('see `src/client/App.tsx:7` for the shell', { sessionId: 's1' });
    const chip = host.querySelector<HTMLElement>('code[data-file-path]');
    expect(chip?.textContent).toBe('src/client/App.tsx:7');
    expect(chip?.getAttribute('data-file-path')).toBe('src/client/App.tsx');
    expect(chip?.getAttribute('data-file-line')).toBe('7');
    expect(chip?.getAttribute('role')).toBe('button');

    act(() => {
      chip!.dispatchEvent(new win.MouseEvent('click', { bubbles: true }) as unknown as Event);
    });

    expect(opened.map((file) => file.path)).toEqual(['src/client/App.tsx']);
    expect(opened[0].root).toBe('/repo');
  });

  test('Enter on a focused chip opens it', () => {
    const host = mount('`src/client/App.tsx`', { sessionId: 's1' });
    const chip = host.querySelector<HTMLElement>('code[data-file-path]')!;

    act(() => {
      chip.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }) as unknown as Event);
    });

    expect(opened.map((file) => file.path)).toEqual(['src/client/App.tsx']);
  });

  test('a click that finishes a text selection does not open a tab', () => {
    const host = mount('`src/client/App.tsx`', { sessionId: 's1' });
    const chip = host.querySelector<HTMLElement>('code[data-file-path]')!;
    const range = document.createRange();
    range.selectNodeContents(chip);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    act(() => {
      chip.dispatchEvent(new win.MouseEvent('click', { bubbles: true }) as unknown as Event);
    });

    expect(opened).toEqual([]);
  });

  test('ordinary inline code stays plain text', () => {
    const host = mount('`bun test` and `state.user.id`', { sessionId: 's1' });
    expect(host.querySelectorAll('code[data-file-path]')).toHaveLength(0);
  });

  test('a document preview is not the chat: its inline code is not marked', () => {
    const host = mount('`src/client/App.tsx`', { sessionId: 's1', document: true });
    expect(host.querySelectorAll('code[data-file-path]')).toHaveLength(0);
  });
});
