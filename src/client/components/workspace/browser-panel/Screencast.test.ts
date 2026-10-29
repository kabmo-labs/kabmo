/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The screencast surface is a CANVAS, and that is a memory contract, not a
 * styling choice.
 *
 * WebKit never releases the decoded image behind a replaced `<img src>` —
 * measured at ~76 KB of WebContent footprint per frame, so a panel left open for
 * half an hour accumulates gigabytes (see `frame-canvas.ts`). This pins the
 * sink: no `<img>` at all, one canvas, a frame painted into it, and the waiting
 * copy only until the first frame lands.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { BrowserScreencast } from '@/client/components/workspace/browser-panel/Screencast';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'HTMLCanvasElement', 'Event', 'Blob'] as const;
const native: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};
let container: HTMLElement | undefined;
let draws = 0;
let closed = 0;

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in native)) native[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
  // A 2D context that records what it was asked to paint. happy-dom has no
  // canvas implementation, so the prototype method is replaced wholesale; the
  // cast names the DOM shape this test is standing in for.
  const canvasProto = win.HTMLCanvasElement.prototype as unknown as Record<string, unknown>;
  canvasProto.getContext = () => ({ drawImage: () => { draws += 1; } });
  (globalThis as Record<string, unknown>).createImageBitmap = async () => ({
    width: 640,
    height: 400,
    close: () => { closed += 1; },
  });
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (native[key] === undefined) delete target[key];
    else target[key] = native[key];
  }
  delete target.createImageBitmap;
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
  container = undefined;
  draws = 0;
  closed = 0;
});

async function mount(frame: { data: string; mimeType: string } | null): Promise<HTMLElement> {
  const host = document.body.appendChild(document.createElement('div'));
  container = host;
  await act(async () => {
    render(
      h(BrowserScreencast, {
        status: 'live',
        url: 'http://example.test',
        tabs: [],
        frame,
        actions: [],
        onSelectTarget: () => {},
        zoomLevel: 100,
      }),
      host,
    );
  });
  return host;
}

const tick = async (): Promise<void> => {
  for (let i = 0; i < 4; i += 1) await act(async () => {});
};

describe('BrowserScreencast', () => {
  test('the frame sink is a canvas, never an <img>', async () => {
    const el = await mount(null);
    await tick();
    expect(el.querySelectorAll('canvas').length).toBe(1);
    expect(el.querySelectorAll('img').length).toBe(0);
  });

  test('the waiting copy shows until a frame has been painted', async () => {
    const el = await mount(null);
    await tick();
    expect(el.textContent).toContain('Menunggu frame pertama');
    expect(el.querySelector('canvas')?.className).toContain('hidden');
  });

  test('a frame is decoded, painted, and the bitmap closed', async () => {
    const el = await mount({ data: btoa('\xff\xd8\xff\xd9'), mimeType: 'image/jpeg' });
    await tick();
    expect(draws).toBe(1);
    expect(closed).toBe(1);
    expect(el.textContent).not.toContain('Menunggu frame pertama');
    expect(el.querySelector('canvas')?.className).not.toContain('hidden');
  });
});
