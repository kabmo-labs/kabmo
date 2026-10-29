/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A plugin's navbar entry that THROWS, and what the host does about it.
 *
 * The entry is drawn by the app's root diff, so a throw from the plugin's own
 * trigger does not merely blank one control. Measured on the assembled product
 * after a server restart: the Stats readout threw (`Cannot read properties of
 * undefined (reading 'probe')`), the throw escaped into the root diff, Preact
 * left the container's vnode bookkeeping half-written, and the next queued
 * render APPENDED a second app tree — two identical navbars, and two of
 * everything under them, until a manual reload.
 *
 * The boundary is what makes that a local failure: the throw is taken at the
 * entry, the row keeps every other control, and the chip names the plugin and
 * the reason so a broken plugin is not mistaken for one that draws nothing.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { HeaderPanelButtons, type HeaderEntry } from '@/client/components/common/header-panel-buttons';
import { SessionStateContext } from '@/client/hooks/workspace/session-state/context';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

const Boom = () => {
  throw new Error('probe is undefined');
};
const Readout = () => <span>CPU 12%</span>;

const ENTRIES: HeaderEntry[] = [
  { pluginId: 'boom', title: 'Boom', Trigger: Boom },
  { pluginId: 'fine', title: 'Fine', Trigger: Readout },
];

let container: HTMLElement | null = null;

beforeEach(() => {
  installDomGlobals(new Window({ url: 'http://127.0.0.1/' }));
});

afterEach(() => {
  if (container) {
    render(null, container);
    container.remove();
    container = null;
  }
  restoreDomGlobals();
});

function mount(entries: HeaderEntry[]): HTMLElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  const host = container;
  // The entry reads the session id from the provider, exactly as the navbar's
  // own host does; a raw provider keeps the case free of the network the real
  // `SessionStateProvider` fetches.
  act(() => {
    render(
      h(SessionStateContext.Provider, {
        value: { sessionId: 'session-1', ready: true },
        children: h(HeaderPanelButtons, { layout: 'desktop', entries }),
      }),
      host,
    );
  });
  return host;
}

describe('a plugin navbar entry that throws', () => {
  test('takes itself off screen and leaves the rest of the row alone', () => {
    const host = mount(ENTRIES);

    // The throw did not escape the boundary: the mount completed and the
    // sibling entry is still drawn.
    expect(host.textContent).toContain('CPU 12%');

    const chip = host.querySelector('[data-plugin-error="boom"]');
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toContain('boom');
    expect(chip?.textContent).toContain('its navbar entry');
    // The reason travels with it — a silent chip would read as "this plugin
    // contributes nothing".
    expect(chip?.textContent).toContain('probe is undefined');
  });

  test('a healthy entry beside it is unaffected', () => {
    const host = mount([ENTRIES[1]!]);
    expect(host.querySelector('[data-plugin-error]')).toBeNull();
    expect(host.textContent).toContain('CPU 12%');
  });
});
