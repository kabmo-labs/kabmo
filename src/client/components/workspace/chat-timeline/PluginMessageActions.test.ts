/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The chat row's plugin action strip.
 *
 * The property that matters is the NEGATIVE one: a Kabmo with no plugin rows
 * renders nothing here, so every existing row's action strip is byte-identical
 * to what it was before this slot existed. A wrapper `<div>`, a spacer or an
 * empty fragment-with-a-parent would all break that silently, so the empty case
 * is asserted against `innerHTML` rather than against "no button".
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { PluginMessageActions } from '@/client/components/workspace/chat-timeline/PluginMessageActions';
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
  // UNMOUNT, not detach: the component subscribes to a module-level store, and a
  // live tree would re-render after `afterAll` removed `window`.
  render(null, container);
  container.remove();
  resetListSlots();
  restoreDomGlobals();
});

afterAll(() => restoreDomGlobals());

/** A plugin button that reports the row props it was handed. Built per
 *  registration so each row is identifiable — the host passes the SLOT's props,
 *  never the registration's own id, which is the plugin's business. */
function makeAction(tag: string) {
  return (props: { messageId: string; role: string; text: string }) =>
    h('button', { 'data-testid': `action-${tag}`, 'data-role': props.role, 'data-message': props.messageId }, props.text);
}

function mount() {
  act(() => {
    render(h(PluginMessageActions, { messageId: 'm1', role: 'ai', text: 'the answer' }), container);
  });
}

describe('PluginMessageActions', () => {
  test('renders nothing at all when no plugin contributed a row', () => {
    mount();
    // The whole acceptance property: an empty slot leaves the tree untouched.
    expect(container.innerHTML).toBe('');
  });

  test('renders a contributed row with the row props', () => {
    registerListSlot('demo', 'messageAction', { id: 'quote', title: 'quote', component: makeAction('quote') });
    mount();

    const button = container.querySelector('[data-testid="action-quote"]');
    expect(button).not.toBeNull();
    expect(button?.getAttribute('data-role')).toBe('ai');
    expect(button?.getAttribute('data-message')).toBe('m1');
    expect(button?.textContent).toBe('the answer');
  });

  test('renders rows in store order, across plugins', () => {
    registerListSlot('beta', 'messageAction', { id: 'b', title: 'b', component: makeAction('b') });
    registerListSlot('alpha', 'messageAction', { id: 'a', title: 'a', order: -1, component: makeAction('a') });
    mount();

    expect([...container.querySelectorAll('button')].map((node) => node.getAttribute('data-testid'))).toEqual([
      'action-a',
      'action-b',
    ]);
  });

  test('a late registration reaches a mounted strip, and a disposal removes it', async () => {
    mount();
    expect(container.innerHTML).toBe('');

    let dispose: () => void = () => {};
    await act(async () => {
      dispose = registerListSlot('demo', 'messageAction', { id: 'late', title: 'late', component: makeAction('late') });
    });
    expect(container.querySelector('[data-testid="action-late"]')).not.toBeNull();

    await act(async () => {
      dispose();
    });
    expect(container.innerHTML).toBe('');
  });
});
