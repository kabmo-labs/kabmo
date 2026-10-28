/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `timelineRenderer` slot's resolution rule.
 *
 * The rule is the contract: a plugin renderer applies only to a tool the HOST
 * has no panel for, so a plugin cannot shadow `bash` or `read` by claiming their
 * names. The resolver itself is a hook, so it is exercised through a probe
 * component — the same way a card uses it.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { usePluginTimelineRenderer } from '@/client/components/workspace/chat-timeline/tool-renderers/plugin-renderers';
import { registerListSlot, resetListSlots } from '@/client/lib/plugins/list-slots';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let container: HTMLElement;

beforeEach(() => {
  resetListSlots();
  installDomGlobals(new Window());
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
  resetListSlots();
  restoreDomGlobals();
});

afterAll(() => restoreDomGlobals());

/** Renders the resolved row's id, or `none`, so the verdict is in the DOM. */
function Probe({ tool }: { tool: string }) {
  const entry = usePluginTimelineRenderer(tool);
  // The resolver hands back the whole store ENTRY now, because the host needs
  // the owning plugin id to wrap the render in that plugin's CSS surface.
  return h('span', { id: 'verdict' }, entry ? entry.registration.id : 'none');
}

function mount(tool: string) {
  act(() => {
    render(h(Probe, { tool }), container);
  });
  return container.querySelector('#verdict')?.textContent;
}

describe('usePluginTimelineRenderer', () => {
  test('resolves nothing when no plugin claimed the tool', () => {
    expect(mount('mytool')).toBe('none');
  });

  test('resolves a plugin renderer for the exact tool name', () => {
    registerListSlot('demo', 'timelineRenderer', { id: 'mytool-panel', tool: 'mytool', component: () => null });
    expect(mount('mytool')).toBe('mytool-panel');
    // Matching is exact: another tool's name must not pick it up.
    expect(mount('other')).toBe('none');
  });

  test('the first row in store order wins a contested tool name', () => {
    registerListSlot('beta', 'timelineRenderer', { id: 'later', tool: 'mytool', order: 5, component: () => null });
    registerListSlot('alpha', 'timelineRenderer', { id: 'earlier', tool: 'mytool', order: -5, component: () => null });
    expect(mount('mytool')).toBe('earlier');
  });
});
