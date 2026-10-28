/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The composer's two list slots.
 *
 * Both are NEGATIVE-first, like every list-slot surface: an empty slot must add
 * nothing to the composer — not a wrapper, not a spacer — so the toolbar row and
 * the strip above the input are unchanged in a Kabmo with no plugins.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import {
  PluginComposerActions,
  PluginComposerBanners,
} from '@/client/components/workspace/chat-timeline/chat-input/PluginComposerSlots';
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

/** Built per registration so each row is identifiable — the host passes the
 *  SLOT's props, never the registration's own id. */
function makeAction(tag: string) {
  return (props: { text: string; isSubmitting: boolean }) =>
    h('button', { 'data-testid': `action-${tag}`, 'data-submitting': String(props.isSubmitting) }, props.text || 'empty');
}

function makeBanner(tag: string) {
  return (props: { sessionId: string | null }) =>
    h('div', { 'data-testid': `banner-${tag}`, 'data-session': String(props.sessionId) }, 'banner');
}

function mountActions(text: string, isSubmitting: boolean) {
  act(() => {
    render(h(PluginComposerActions, { text, isSubmitting }), container);
  });
}

function mountBanners() {
  act(() => {
    render(h(PluginComposerBanners, {}), container);
  });
}

describe('PluginComposerActions', () => {
  test('renders nothing when no plugin contributed an action', () => {
    mountActions('draft', false);
    expect(container.innerHTML).toBe('');
  });

  test('hands a contributed action the draft and the in-flight flag', () => {
    registerListSlot('demo', 'composerAction', { id: 'send', title: 'send', component: makeAction('send') });
    mountActions('hello', true);

    const button = container.querySelector('[data-testid="action-send"]');
    expect(button?.textContent).toBe('hello');
    expect(button?.getAttribute('data-submitting')).toBe('true');
  });

  test('renders two plugins’ actions in store order', () => {
    registerListSlot('beta', 'composerAction', { id: 'b', title: 'b', component: makeAction('b') });
    registerListSlot('alpha', 'composerAction', { id: 'a', title: 'a', order: -1, component: makeAction('a') });
    mountActions('', false);

    expect([...container.querySelectorAll('button')].map((node) => node.getAttribute('data-testid'))).toEqual([
      'action-a',
      'action-b',
    ]);
  });
});

describe('PluginComposerBanners', () => {
  test('renders nothing when no plugin contributed a banner', () => {
    mountBanners();
    expect(container.innerHTML).toBe('');
  });

  test('renders a contributed banner with the published context', () => {
    registerListSlot('demo', 'composerBanner', { id: 'notice', title: 'notice', component: makeBanner('notice') });
    mountBanners();

    const banner = container.querySelector('[data-testid="banner-notice"]');
    expect(banner).not.toBeNull();
    // No layout has published a session in this test, so the context is the
    // module's own default rather than a fabricated id.
    expect(banner?.getAttribute('data-session')).toBe('null');
  });
});
