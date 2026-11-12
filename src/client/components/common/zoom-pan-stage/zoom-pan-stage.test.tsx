/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The shared zoom/pan surface.
 *
 * happy-dom has no layout engine, so `offsetWidth` is 0 and the stage never
 * fits — which is exactly why these tests pin the parts that do not need a
 * measurement: the footer's controls, the zoom arithmetic behind them, and the
 * caption. The fit itself is exercised in the browser (the drawio smoke test).
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { ZoomPanStage as ZoomPanStageType } from '@/client/components/common/zoom-pan-stage';

let ZoomPanStage: typeof ZoomPanStageType;
let container: HTMLElement;

beforeAll(async () => {
  const win = new Window({ url: 'http://localhost' });
  installDomGlobals(win);
  // Dynamic on purpose: the module must be evaluated AFTER the DOM globals
  // exist, which is the same order `viewers.test.ts` uses.
  ({ ZoomPanStage } = await import('@/client/components/common/zoom-pan-stage'));
});

afterAll(() => restoreDomGlobals());

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
});

async function mount(node: unknown) {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(node as never, container);
  });
  return container;
}

describe('ZoomPanStage', () => {
  test('offers the three controls and starts at 100%', async () => {
    await mount(h(ZoomPanStage, { measureKey: 0, children: h('div', null, 'content') }));
    expect(container.querySelector('button[title="Zoom in (+)"]')).not.toBeNull();
    expect(container.querySelector('button[title="Zoom out (-)"]')).not.toBeNull();
    expect(container.querySelector('button[title="Fit to view (0)"]')).not.toBeNull();
    expect(container.querySelector('.tabular-nums')?.textContent).toBe('100%');
  });

  // The buttons and the +/- keys share one step, so a click must move the
  // readout by exactly that factor.
  test('zoom in and out move the readout by the step', async () => {
    await mount(h(ZoomPanStage, { measureKey: 0, children: h('div', null, 'content') }));
    await act(async () => {
      (container.querySelector('button[title="Zoom in (+)"]') as HTMLButtonElement).click();
    });
    expect(container.querySelector('.tabular-nums')?.textContent).toBe('140%');
    await act(async () => {
      (container.querySelector('button[title="Zoom out (-)"]') as HTMLButtonElement).click();
    });
    expect(container.querySelector('.tabular-nums')?.textContent).toBe('100%');
  });

  test('the caption replaces the measured size', async () => {
    await mount(h(ZoomPanStage, { measureKey: 0, caption: '3 pages', children: h('div', null, 'content') }));
    expect(container.textContent).toContain('3 pages');
  });

  test('the overlay is drawn over the stage, unscaled', async () => {
    await mount(
      h(ZoomPanStage, {
        measureKey: 0,
        overlay: h('span', { class: 'overlay-marker' }, 'loading'),
        children: h('div', null, 'content'),
      }),
    );
    expect(container.querySelector('.overlay-marker')).not.toBeNull();
  });
});
