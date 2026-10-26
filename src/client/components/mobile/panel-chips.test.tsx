/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The phone's panel strip and dock body — the LEFT drawer's half of the panel
 * system, which did not exist before.
 *
 * Three properties, and each was the reported symptom:
 *
 * - A placed plugin panel gets a CHIP in the left drawer. Before this the
 *   placement was stored, the desktop drew a button for it, and a phone had no
 *   surface at all — the panel was reachable only through the right drawer.
 * - The chip that is ON is the one marked pressed, so the drawer says which
 *   panel it is showing.
 * - A stored view naming a panel that no longer resolves draws the NOTICE, not
 *   a blank column, and keeps the strip so the session list is reachable.
 *
 * Rendered with `h()` against happy-dom, with the kit's services installed so a
 * plugin row resolves its identity the way the real host resolves it.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { configureUiKit } from '@kabmo-labs/kabmo-ui';
import { makeUiKitServices } from '@kabmo-labs/kabmo-sdk/testing';
import { PanelChips } from '@/client/components/mobile/panel-chips';
import { MobileDockBody } from '@/client/components/mobile/mobile-session-sidebar/Dock';
import type { ResolvedPanel } from '@/client/components/workspace/plugin-panel/catalog';
import type { PanelBodyProps } from '@/client/components/workspace/panels/builtin';
import { restoreRealtime, silenceRealtime } from '@/test-support/silent-socket';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event', 'MouseEvent'] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

let container: HTMLElement;

beforeAll(() => {
  configureUiKit(makeUiKitServices());
});

beforeEach(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in nativeGlobals)) nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
  // The dock's body renders panels, and a real panel reads a realtime topic on
  // mount. This window's origin is `localhost`, where nothing listens, so a real
  // dial fails asynchronously — after this suite has restored the globals, which
  // reports as an unhandled error in the NEXT file.
  silenceRealtime();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
  restoreRealtime();
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (key in nativeGlobals) target[key] = nativeGlobals[key];
    else delete target[key];
  }
});

/** A catalog entry with only what the strip and the body read. */
function panel(id: string, overrides: Partial<ResolvedPanel> = {}): ResolvedPanel {
  return {
    id,
    side: id === 'sessions' ? 'left' : 'left',
    title: `${id} title`,
    label: id,
    name: '',
    builtin: true,
    requiresWorkspace: false,
    liveWhileHidden: false,
    minWidth: 200,
    defaultWidth: 280,
    defaultFraction: 0.25,
    render: () => h('div', { 'data-rendered': id }, `body of ${id}`),
    ...overrides,
  };
}

const body: PanelBodyProps = { enabled: true, active: true, refreshKey: 0 };

async function mountStrip(panels: ResolvedPanel[], activeId: string, onSelect = (_id: string) => {}) {
  await act(async () => {
    render(h(PanelChips, { panels, activeId, onSelect }), container);
  });
}

describe('PanelChips', () => {
  test('draws one chip per panel, in the order it is given', async () => {
    await mountStrip([panel('sessions'), panel('plugin:demo:rightPanel', { builtin: false, name: 'demo', title: 'Demo — demo' })], 'sessions');
    const labels = [...container.querySelectorAll('button')].map((el) => el.getAttribute('title'));
    expect(labels).toEqual(['sessions title', 'Demo — demo']);
  });

  test('the active chip is the pressed one, and only it', async () => {
    await mountStrip([panel('sessions'), panel('plugin:demo:rightPanel', { builtin: false, name: 'demo' })], 'plugin:demo:rightPanel');
    const pressed = [...container.querySelectorAll('button')].map((el) => el.getAttribute('aria-pressed'));
    expect(pressed).toEqual(['false', 'true']);
  });

  test('a click hands back the panel id, which is what the drawer stores', async () => {
    const picked: string[] = [];
    await mountStrip([panel('sessions'), panel('plugin:demo:rightPanel', { builtin: false, name: 'demo' })], 'sessions', (id) => picked.push(id));
    const chip = [...container.querySelectorAll('button')].at(-1) as HTMLButtonElement;
    await act(async () => chip.click());
    expect(picked).toEqual(['plugin:demo:rightPanel']);
  });

  test('the Source Control dot is drawn only where it is asked for', async () => {
    // The left catalog never holds a built-in view, so the left drawer passes
    // nothing and must not grow a dot it can never mean.
    await mountStrip([panel('git', { title: 'Source Control', label: 'GIT' })], 'git');
    expect(container.querySelector('[title="Uncommitted changes"]')).toBeNull();
    render(null, container);
    await act(async () => {
      render(h(PanelChips, { panels: [panel('git', { title: 'Source Control', label: 'GIT' })], activeId: 'git', onSelect: () => {}, hasGitChanges: true }), container);
    });
    expect(container.querySelector('[title="Uncommitted changes"]')).not.toBeNull();
  });
});

describe('PanelChips reveal', () => {
  // happy-dom computes no layout, so the strip's geometry is stubbed: a 300px
  // window over six 80px chips, which is a phone-width strip with a panel past
  // its right edge. The defect this pins is a DECISION about that geometry, so
  // the arithmetic is asserted here rather than in a browser.
  const STRIP_W = 300;
  const CHIP_W = 80;
  let rect: typeof Element.prototype.getBoundingClientRect;
  let clientWidth: PropertyDescriptor | undefined;
  let scrollWidth: PropertyDescriptor | undefined;

  const isStrip = (el: Element) => el instanceof HTMLElement && el.className.includes('overflow-x-auto');

  function box(width: number, left: number): DOMRect {
    return { width, height: 24, top: 0, left, right: left + width, bottom: 24, x: left, y: 0, toJSON: () => ({}) } as DOMRect;
  }

  beforeEach(() => {
    rect = Element.prototype.getBoundingClientRect;
    clientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    scrollWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth');
    Element.prototype.getBoundingClientRect = function (this: Element) {
      if (isStrip(this)) return box(STRIP_W, 0);
      const siblings = [...(this.parentElement?.querySelectorAll('button') ?? [])];
      const index = siblings.indexOf(this as HTMLButtonElement);
      return index === -1 ? box(0, 0) : box(CHIP_W, index * CHIP_W);
    };
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return isStrip(this) ? STRIP_W : (clientWidth?.get?.call(this) ?? 0);
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return isStrip(this) ? CHIP_W * 6 : (scrollWidth?.get?.call(this) ?? 0);
      },
    });
  });

  afterEach(() => {
    Element.prototype.getBoundingClientRect = rect;
    if (clientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidth);
    if (scrollWidth) Object.defineProperty(HTMLElement.prototype, 'scrollWidth', scrollWidth);
  });

  const six = () => Array.from({ length: 6 }, (_, index) => panel(`p${index}`));

  test('a chip selected from outside the strip is scrolled into view', async () => {
    // The navbar readout's shape: the drawer mounts with the panel already
    // stored, so the strip has to move on the very first render.
    await mountStrip(six(), 'p5');
    const strip = container.querySelector('div') as HTMLDivElement;
    // 5 × 80 = 400 leading; 480 + 8 pad − 300 window = 188, under the 180 range
    // … so the offset is clamped to the range's end.
    expect(strip.scrollLeft).toBe(CHIP_W * 6 - STRIP_W);
  });

  test('a chip already in view leaves the strip where it is', async () => {
    await mountStrip(six(), 'p0');
    const strip = container.querySelector('div') as HTMLDivElement;
    expect(strip.scrollLeft).toBe(0);
  });

  test('moving the selection from outside scrolls to the new chip', async () => {
    await act(async () => {
      render(h(PanelChips, { panels: six(), activeId: 'p0', onSelect: () => {} }), container);
    });
    const strip = container.querySelector('div') as HTMLDivElement;
    expect(strip.scrollLeft).toBe(0);
    await act(async () => {
      render(h(PanelChips, { panels: six(), activeId: 'p4', onSelect: () => {} }), container);
    });
    expect(strip.scrollLeft).toBeGreaterThan(0);
  });
});

describe('MobileDockBody', () => {
  test('renders the panel it is handed', async () => {
    await act(async () => {
      render(h(MobileDockBody, { panelKey: 'plugin:demo:rightPanel', panel: panel('plugin:demo:rightPanel', { builtin: false, name: 'demo' }), body }), container);
    });
    expect(container.querySelector('[data-rendered="plugin:demo:rightPanel"]')).not.toBeNull();
  });

  test('a panel that does not resolve says WHY instead of drawing a blank column', async () => {
    // No provider is installed for this key, so the notice reports "no plugin
    // with this id is installed" — the same component the desktop dock uses.
    await act(async () => {
      render(h(MobileDockBody, { panelKey: 'plugin:gone:rightPanel', panel: undefined, body }), container);
    });
    expect(container.textContent).toContain('Plugin unavailable');
    // The notice names the PLUGIN, not the instance key, and gives the reason.
    expect(container.textContent).toContain('gone');
    expect(container.textContent).toContain('no plugin with this id is installed');
  });
});
