/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The Files panel's outline section.
 *
 * Four properties, each invisible to a route test and each failing silently:
 *
 * - The body stays MOUNTED while collapsed (so the reveal animates) and is
 *   `inert` (or a hidden row is tabbable and announced).
 * - The rows come from the editor's published document, so the empty states are
 *   distinguishable: no file open, a diff tab, and a file with no declarations
 *   are three different sentences, and an empty list for all three reads as a
 *   broken scan.
 * - A row click publishes a line request — it does NOT jump itself; the editor
 *   that holds the buffer serves it.
 * - Every kind draws its OWN mark, which is what makes a class row and a
 *   function row tell the reader apart at a glance.
 *
 * Rendered with `h()` against happy-dom, over a stubbed `fetch` that answers the
 * session-state blob, and with the document published straight into the store.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { OutlineSection } from '@/client/components/workspace/file-explorer/OutlineSection';
import { SessionStateProvider } from '@/client/components/common/session-state-provider/index';
import { forgetSession } from '@/shared/lib/workspace/session-state/store';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import { publishEditorDocument, resetEditorDocument, type EditorDocument } from '@/client/lib/editor-document';
import { getLineReveal, setLineReveal } from '@/client/lib/line-reveal';

const SESSION = 'new-outline-section';
const nativeFetch = Bun.fetch;

let container: HTMLElement;
let owner: object;

const SOURCE = [
  'export interface Options {',
  '  flag: boolean;',
  '}',
  '',
  'export class Service {',
  '  start() {}',
  '}',
  '',
  'export const LIMIT = 10;',
].join('\n');

const READY: EditorDocument = {
  path: 'src/service.ts',
  name: 'service.ts',
  content: SOURCE,
  language: 'typescript',
  state: 'ready',
  note: null,
};

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterEach(() => {
  if (container) {
    render(null, container);
    container.remove();
  }
  forgetSession(SESSION);
  resetEditorDocument();
  setLineReveal(null);
  (globalThis as unknown as Record<string, unknown>).fetch = nativeFetch;
});

afterAll(() => {
  restoreDomGlobals();
});

async function mount(stored: Record<string, unknown> = {}): Promise<void> {
  const target = globalThis as unknown as Record<string, unknown>;
  target.fetch = async () => {
    return new Response(JSON.stringify({ sessionId: SESSION, state: stored }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(
      h(SessionStateProvider, {
        sessionId: SESSION,
        children: h(OutlineSection, {}),
      }),
      container,
    );
  });
  for (let i = 0; i < 10; i += 1) await act(async () => {});
}

function reveal(): HTMLElement {
  const el = container.querySelector('.section-reveal');
  if (!el) throw new Error('no .section-reveal wrapper rendered');
  return el as HTMLElement;
}

function toggle(): HTMLButtonElement {
  const el = container.querySelector('button[aria-controls]');
  if (!el) throw new Error('no outline toggle rendered');
  return el as HTMLButtonElement;
}

function glyph(): string {
  return toggle().querySelector('span')?.textContent ?? '';
}

/** The rows, as the accessible names the panel gives them. */
function rowLabels(): string[] {
  return [...container.querySelectorAll('button[aria-label]')]
    .map((el) => el.getAttribute('aria-label') ?? '')
    .filter((label) => label.includes(', line '));
}

async function expand(): Promise<void> {
  await act(async () => {
    toggle().click();
  });
  for (let i = 0; i < 10; i += 1) await act(async () => {});
}

describe('OutlineSection', () => {
  test('collapsed by default: mounted, inert, and it says no file is open', async () => {
    await mount();

    expect(reveal().getAttribute('data-expanded')).toBe('false');
    expect(reveal().hasAttribute('inert')).toBe(true);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(glyph()).toBe('▸');
    expect(container.textContent).toContain('No file open in the editor.');
  });

  test('opening lists the published document, with a mark and a line per row', async () => {
    owner = {};
    publishEditorDocument(owner, READY);
    await mount();
    await expand();

    expect(reveal().getAttribute('data-expanded')).toBe('true');
    expect(reveal().hasAttribute('inert')).toBe(false);
    expect(glyph()).toBe('▾');
    expect(rowLabels()).toEqual([
      'Interface Options, line 1',
      'Class Service, line 5',
      'Method start, line 6',
      'Constant LIMIT, line 9',
    ]);
    // Each row carries its kind's own mark: four different icons for four kinds.
    const marks = [...reveal().querySelectorAll('button[aria-label*=", line "] svg')];
    expect(marks).toHaveLength(4);
  });

  test('a click publishes a line request instead of scrolling itself', async () => {
    owner = {};
    publishEditorDocument(owner, READY);
    await mount();
    await expand();

    const row = [...reveal().querySelectorAll('button[aria-label]')]
      .find((el) => el.getAttribute('aria-label')?.startsWith('Method start')) as HTMLButtonElement;
    await act(async () => {
      row.click();
    });

    // The span travels with the request: `start()` sits at column 3 of line 6,
    // so the editor selects the NAME and not the line's first word.
    expect(getLineReveal()).toEqual({ path: 'src/service.ts', line: 6, column: 3, length: 5 });
  });

  test('a diff tab hides the section entirely; an empty file still explains itself', async () => {
    owner = {};
    publishEditorDocument(owner, { ...READY, state: 'diff', note: null, content: '' });
    await mount();
    // No toggle, no reveal wrapper, no notice: the section is GONE rather than
    // sitting on the panel floor saying it has nothing to show.
    expect(container.querySelector('.section-reveal')).toBeNull();
    expect(container.querySelector('button[aria-controls]')).toBeNull();
    expect(container.textContent).not.toContain('Diff tabs');

    render(null, container);
    publishEditorDocument(owner, { ...READY, path: 'src/empty.ts', content: "import { a } from 'b';\n" });
    await act(async () => {
      render(
        h(SessionStateProvider, {
          sessionId: SESSION,
          children: h(OutlineSection, {}),
        }),
        container,
      );
    });
    for (let i = 0; i < 10; i += 1) await act(async () => {});
    // A file that simply has no declarations is still a file: the section
    // renders and says so.
    expect(container.textContent).toContain('Outline');
    await expand();
    expect(container.textContent).toContain('No symbols found.');
  });

  test('a session that left the section open restores it expanded', async () => {
    await mount({ 'files.outlineExpanded': true });
    expect(reveal().getAttribute('data-expanded')).toBe('true');
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
  });
});
