/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The list-slot read hook.
 *
 * Its whole job is reactivity: a surface reads the merged rows and must see a
 * row appear or leave WITHOUT a remount. It deliberately does not sort — that is
 * `listSlotRows`'s one implementation — so the ordering assertions live in the
 * store's own test and this one pins the subscription.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { useListSlotRows, usePluginSlotContext } from '@/client/hooks/workspace/list-slots';
import { registerListSlot, resetListSlots } from '@/client/lib/plugins/list-slots';
import { setPluginContext } from '@/client/lib/plugins/context';
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
  setPluginContext(null, null);
  restoreDomGlobals();
});

afterAll(() => restoreDomGlobals());

/** Renders the slot's row ids, so the read is assertable from the DOM. */
function Rows() {
  const rows = useListSlotRows('composerBanner');
  return h('span', { id: 'rows' }, rows.map((entry) => entry.registration.id).join(','));
}

/** Renders the published session, so a context change is assertable. */
function Context() {
  const { sessionId, workspacePath } = usePluginSlotContext();
  return h('span', { id: 'ctx' }, `${sessionId ?? 'none'}|${workspacePath ?? 'none'}`);
}

describe('useListSlotRows', () => {
  test('reads the merged rows and follows a registration', async () => {
    act(() => {
      render(h(Rows, {}), container);
    });
    expect(container.querySelector('#rows')?.textContent).toBe('');

    await act(async () => {
      registerListSlot('demo', 'composerBanner', { id: 'notice', component: () => null });
    });
    expect(container.querySelector('#rows')?.textContent).toBe('notice');

    await act(async () => {
      registerListSlot('other', 'composerBanner', { id: 'second', component: () => null });
    });
    expect(container.querySelector('#rows')?.textContent).toBe('notice,second');
  });
});

describe('usePluginSlotContext', () => {
  test('starts from the published context and follows a publish', async () => {
    act(() => {
      render(h(Context, {}), container);
    });
    expect(container.querySelector('#ctx')?.textContent).toBe('none|none');

    await act(async () => {
      setPluginContext('s1', '/ws');
    });
    expect(container.querySelector('#ctx')?.textContent).toBe('s1|/ws');
  });
});
