/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The editor column's plugin slot (`app.panel`).
 *
 * The slot was registered and NEVER rendered: `WorkspacePanels` passed
 * `activeEditorPanelKey={null}` hard-coded and no call site ever wrote it, so a
 * plugin that shipped two panels — `marketplace/plugins/session-info` registers a
 * `rightPanel` and a `panel` — had exactly one of them reachable. These cases pin
 * the two halves that make it reachable: a rail that can switch to it, and a
 * column that stays open for it with no file behind it.
 *
 * The rail is a plain component, so it is asserted directly. The open/closed
 * decision belongs to the layout and is asserted through `showEditor`'s own rule
 * (`openedFiles.length > 0 || an editor plugin is chosen`), which this file
 * reproduces rather than mounts the whole desktop for.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { EditorPluginRail } from '@/client/components/workspace/editor/PluginRail';
import type { ResolvedPluginPanel } from '@/client/components/workspace/plugin-panel/resolve';
import { installDomGlobals } from '@/test-support/pristine-globals';

let container: HTMLElement | null = null;

// Installed per CASE: another suite's teardown can strip `window` mid-file when
// the runner interleaves files, and this hook's first render would then throw.
beforeEach(() => {
  installDomGlobals(new Window({ url: 'http://127.0.0.1:1' }));
});

function panel(pluginId: string, title: string): ResolvedPluginPanel {
  return {
    panelKey: `plugin:${pluginId}`,
    pluginId,
    name: pluginId,
    title,
    Component: () => null,
  };
}

async function mountRail(props: {
  activeKey: string | null;
  plugins: ResolvedPluginPanel[];
  onSelect?: (key: string | null) => void;
}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  container = host;
  await act(async () => {
    render(
      h(EditorPluginRail, {
        activeKey: props.activeKey,
        onSelect: props.onSelect ?? (() => {}),
        plugins: props.plugins,
      }),
      host,
    );
  });
}

const buttons = () =>
  [...(container?.querySelectorAll('nav[aria-label="Editor panel views"] button') ?? [])].map((el) => ({
    label: el.getAttribute('aria-label'),
    pressed: el.getAttribute('aria-pressed'),
  }));

afterEach(() => {
  if (container) {
    render(null, container);
    container.remove();
    container = null;
  }
});

describe('editor plugin rail', () => {
  test('draws nothing when no plugin took the column over', async () => {
    await mountRail({ activeKey: null, plugins: [] });
    // A rail with only "Files" would be a control that never changes anything,
    // so a Kabmo without such a plugin looks exactly as it did.
    expect(container!.querySelector('nav')).toBeNull();
  });

  test('offers Files and every takeover, with the active one pressed', async () => {
    await mountRail({ activeKey: 'plugin:session-info', plugins: [panel('session-info', 'Scratchpad')] });
    expect(buttons()).toEqual([
      { label: 'Files', pressed: 'false' },
      { label: 'Scratchpad', pressed: 'true' },
    ]);
  });

  test('Files is always an entry, so a takeover is reversible', async () => {
    const selected: (string | null)[] = [];
    await mountRail({
      activeKey: 'plugin:demo',
      plugins: [panel('demo', 'Demo')],
      onSelect: (key) => selected.push(key),
    });
    const files = [...container!.querySelectorAll('nav button')].find(
      (el) => el.getAttribute('aria-label') === 'Files',
    ) as HTMLButtonElement;
    await act(async () => files.click());
    // `null`, not a sentinel: the layout's own state spells "no plugin" that way.
    expect(selected).toEqual([null]);
  });

  test('choosing a takeover reports its panel key', async () => {
    const selected: (string | null)[] = [];
    await mountRail({
      activeKey: null,
      plugins: [panel('demo', 'Demo')],
      onSelect: (key) => selected.push(key),
    });
    const takeover = [...container!.querySelectorAll('nav button')].find(
      (el) => el.getAttribute('aria-label') === 'Demo',
    ) as HTMLButtonElement;
    await act(async () => takeover.click());
    expect(selected).toEqual(['plugin:demo']);
  });
});
