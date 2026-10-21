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
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
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
