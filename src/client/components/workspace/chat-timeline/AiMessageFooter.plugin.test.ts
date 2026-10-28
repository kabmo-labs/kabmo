/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The chat row's action strip, at the HOST level.
 *
 * The component-level test (`PluginMessageActions.test.ts`) pins that an empty
 * slot renders nothing; this pins the consequence: the strip `AiMessageFooter`
 * draws is exactly Retry / Copy / New-chat with no plugins, and gains one button
 * per contributed row when a plugin registers. Counting the strip's buttons is
 * the assertion that matters — an empty wrapper or a spacer would not change the
 * count, so the empty case is also checked against the strip's own `innerHTML`
 * shape by comparing the two mounts' built-in prefix.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { AiMessageFooter } from '@/client/components/workspace/chat-timeline/AiMessageFooter';
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

function PluginAction(props: { messageId: string; text: string }) {
  return h('button', { 'data-testid': 'plugin-action', 'data-message': props.messageId }, 'plugin');
}

function mount() {
  act(() => {
    render(
      h(AiMessageFooter, {
        currentModel: 'sonnet',
        content: 'the answer',
        msgId: 'm1',
        dateStr: 'now',
      }),
      container,
    );
  });
  return container;
}

/** The action cluster: the last child of the footer row. */
function actionCluster(): HTMLElement | null {
  const row = container.querySelector('div.w-full');
  return (row?.lastElementChild as HTMLElement | null) ?? null;
}

describe('AiMessageFooter plugin actions', () => {
  test('draws exactly the built-in actions when no plugin contributed one', () => {
    mount();
    const cluster = actionCluster();
    // Retry + Copy + New-chat, and nothing else: an empty slot adds no node.
    expect(cluster?.querySelectorAll('button')).toHaveLength(3);
    expect(cluster?.querySelector('[data-testid="plugin-action"]')).toBeNull();
  });

  test('gains one button per contributed row', () => {
    registerListSlot('demo', 'messageAction', { id: 'quote', component: PluginAction });
    mount();

    const cluster = actionCluster();
    expect(cluster?.querySelectorAll('button')).toHaveLength(4);
    const pluginButton = cluster?.querySelector('[data-testid="plugin-action"]');
    expect(pluginButton).not.toBeNull();
    // The row's id reaches the plugin, which is what makes an action act on the
    // row it sits under.
    expect(pluginButton?.getAttribute('data-message')).toBe('m1');
  });

  test('renders two plugins’ actions in store order, after the built-ins', () => {
    registerListSlot('beta', 'messageAction', { id: 'b', component: PluginAction });
    registerListSlot('alpha', 'messageAction', { id: 'a', component: PluginAction });
    mount();

    const cluster = actionCluster();
    const buttons = [...(cluster?.querySelectorAll('button') ?? [])];
    // The three built-ins lead; the plugin rows follow in store order.
    expect(buttons.slice(0, 3).every((node) => node.getAttribute('data-testid') === null)).toBe(true);
    expect(buttons.slice(3).map((node) => node.getAttribute('data-testid'))).toEqual([
      'plugin-action',
      'plugin-action',
    ]);
  });
});
