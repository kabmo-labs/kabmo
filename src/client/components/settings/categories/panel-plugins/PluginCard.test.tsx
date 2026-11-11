/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Update button on an INSTALLED plugin card.
 *
 * One button for two sources, and the card is where the difference shows: a git
 * clone's Update sits in its freshness row beside the commit pair it would move,
 * while a bundled install's sits in the footer because the store has no commit to
 * show. A card that rendered neither — the reported shape before this change —
 * left a plugin with a pending update and no way to apply it.
 *
 * The negative cases are the load-bearing ones: a current plugin, an unknown one
 * and a local directory must offer NO button, because a button that does nothing
 * is worse than none.
 *
 * Rendered with `h()` against happy-dom, following the panel suites.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { PluginCard } from '@/client/components/settings/categories/panel-plugins/PluginCard';
import type { LeftDockHandle } from '@/client/hooks/workspace/left-dock';
import type { PanelGitStatus, PanelPluginStatus } from '@/shared/types';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let container: HTMLElement;

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterEach(() => {
  if (container) render(null, container);
});

afterAll(() => {
  restoreDomGlobals();
});

function mount(node: h.JSX.Element): HTMLElement {
  container = document.createElement('div');
  document.body.append(container);
  act(() => render(node, container));
  return container;
}

/** Only a real shape matters here: the card reads it for placement chips. */
const DOCK = {
  enabled: false,
  panels: [],
  setEnabled: () => {},
  setSide: () => {},
  widthOf: () => 320,
  commitWidth: () => {},
} satisfies LeftDockHandle;

const BASE: PanelPluginStatus = {
  pluginId: 'demo',
  name: 'Demo',
  version: '1.0.0',
  built: true,
  isPackage: true,
  enabled: true,
  bundled: true,
  origin: 'bundled',
  gitOrigin: null,
};

const GIT_STATUS: PanelGitStatus = {
  current: 'aaaaaaa',
  latest: 'bbbbbbb',
  updateAvailable: true,
  checkedAt: Date.now(),
};

function card(plugin: PanelPluginStatus, gitStatus: PanelGitStatus | undefined, onUpdate = async () => true) {
  return mount(
    h(PluginCard, {
      plugin,
      entry: undefined,
      failure: undefined,
      iconUrl: undefined,
      readmeUrl: undefined,
      busy: null,
      gitStatus,
      dock: DOCK,
      onReadme: () => {},
      onSettings: () => {},
      onBuild: async () => true,
      onRemove: async () => true,
      onSetEnabled: async () => true,
      onUpdate,
    }),
  );
}

/** Every button whose label is exactly Update (the freshness row's and the footer's). */
function updateButtons(el: HTMLElement): HTMLButtonElement[] {
  return Array.from(el.querySelectorAll('button')).filter((button) => button.textContent?.trim() === 'Update');
}

describe('a bundled install with an update', () => {
  test('offers Update in the footer, and says what it would apply', () => {
    const el = card({ ...BASE, latestVersion: '1.1.0' }, undefined);
    const buttons = updateButtons(el);
    expect(buttons).toHaveLength(1);
    expect(buttons[0].getAttribute('title')).toContain('v1.1.0');
  });

  test('does not offer one when the store ships the same version', () => {
    expect(updateButtons(card({ ...BASE, latestVersion: '1.0.0' }, undefined))).toHaveLength(0);
    expect(updateButtons(card(BASE, undefined))).toHaveLength(0);
  });
});

describe('a git clone', () => {
  test('offers Update in its freshness row, and none in the footer', () => {
    const el = card(
      { ...BASE, bundled: false, origin: 'git', gitOrigin: 'https://x/y.git' },
      GIT_STATUS,
    );
    const buttons = updateButtons(el);
    expect(buttons).toHaveLength(1);
    // The row's own button names the origin it would fetch from.
    expect(buttons[0].getAttribute('title')).toContain('https://x/y.git');
  });

  test('offers none when the probe found nothing to fetch', () => {
    const el = card(
      { ...BASE, bundled: false, origin: 'git', gitOrigin: 'https://x/y.git' },
      { ...GIT_STATUS, updateAvailable: false, latest: 'aaaaaaa' },
    );
    expect(updateButtons(el)).toHaveLength(0);
  });
});

describe('a local directory', () => {
  test('never offers Update, even with a newer version beside it', () => {
    const el = card(
      { ...BASE, bundled: false, origin: 'local', gitOrigin: null, latestVersion: '2.0.0' },
      GIT_STATUS,
    );
    expect(updateButtons(el)).toHaveLength(0);
  });
});
