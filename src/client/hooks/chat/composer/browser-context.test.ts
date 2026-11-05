/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The composer half of the browser-panel bridge.
 *
 * The failure this guards is a prompt that names a page the agent cannot place.
 * The block is produced by `shared/lib/browser/page-context` (its own tests pin
 * the text); what is pinned HERE is the wiring: an event appends, two events do
 * not overwrite, and a malformed batch degrades to the plain block instead of
 * rendering `NaN%` into the draft.
 *
 * An annotated page sends NO attachment — the user panel's page is a
 * cross-origin iframe, so there are no bytes to attach.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { useBrowserPageContextInsert } from '@/client/hooks/chat/composer/browser-context';
import { emitBrowserPageContext } from '@/shared/lib/browser/page-context';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event', 'CustomEvent'] as const;
const native: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in native)) native[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (native[key] === undefined) delete target[key];
    else target[key] = native[key];
  }
});

let container: HTMLElement | undefined;
let draft = '';

/** Mount the bridge over a draft string, the way the composer wires it. */
function mountBridge(): void {
  draft = '';
  const Probe = () => {
    useBrowserPageContextInsert((next) => {
      draft = typeof next === 'function' ? next(draft) : next;
    });
    return h('div', null);
  };
  container = document.body.appendChild(document.createElement('div'));
  act(() => {
    render(h(Probe, null), container!);
  });
}

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
  container = undefined;
});

describe('useBrowserPageContextInsert', () => {
  test('a plain page lands in the draft as the URL block', () => {
    mountBridge();
    act(() => emitBrowserPageContext({ url: 'https://a.test/x' }));
    expect(draft).toBe('[Browser page context]\nURL: https://a.test/x\n(Continue from this page.)');
  });

  test('an annotated page lands as the block with its numbered marks', () => {
    mountBridge();
    act(() => emitBrowserPageContext({
      url: 'https://a.test/x',
      annotations: [{ id: 'a', tool: 'box', start: { x: 0.1, y: 0.1 }, end: { x: 0.2, y: 0.2 }, label: '', note: 'mati' }],
      panel: { width: 1000, height: 500, viewportMode: 'laptop', zoom: 100 },
    }));
    expect(draft).toContain('Annotations (1):');
    expect(draft).toContain('1. box left 10.0%, top 10.0%');
    expect(draft).toContain(': mati');
  });

  test('two events append two blocks rather than overwriting the draft', () => {
    mountBridge();
    act(() => emitBrowserPageContext({ url: 'https://a.test' }));
    act(() => emitBrowserPageContext({ url: 'https://b.test' }));
    expect(draft.match(/\[Browser page context\]/g)).toHaveLength(2);
    expect(draft).toContain('https://a.test');
    expect(draft).toContain('https://b.test');
  });

  test('a detail with no url is ignored rather than pasting an empty block', () => {
    mountBridge();
    act(() => emitBrowserPageContext({ url: '' }));
    expect(draft).toBe('');
  });

  test('a malformed mark batch degrades to the plain page block, never to NaN%', () => {
    mountBridge();
    act(() => emitBrowserPageContext({
      url: 'https://a.test',
      // A shape missing `end`/`note`, as a hand-written event or an older
      // dispatch could carry: the reader must refuse it, not format it.
      annotations: [{ id: 'a', tool: 'box', start: { x: 1, y: 0 } } as never],
      panel: { width: 1000, height: 500, viewportMode: 'laptop', zoom: 100 },
    }));
    expect(draft).not.toContain('Annotations');
    expect(draft).toContain('URL: https://a.test');
  });
});
