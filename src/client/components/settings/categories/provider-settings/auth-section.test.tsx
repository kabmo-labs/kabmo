/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The connection controls on the provider detail pane.
 *
 * A provider is TWO independent facts — "omp can sign this in" and "this has a
 * `models.yml` entry" — and the panel used to collapse them into one button, so
 * a provider that is both (an Anthropic override pointing at a proxy) could
 * either sign in or be edited, never both. Each button here is a different
 * write, and the press has to route to the dialog that performs it.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { ProviderAuthSection } from '@/client/components/settings/categories/provider-settings/AuthSection';
import type { ProviderItem } from '@/shared/types';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let container: HTMLElement;
let pressed: string[];

function provider(overrides: Partial<ProviderItem> & { slug: string }): ProviderItem {
  return {
    id: `id-${overrides.slug}`,
    name: overrides.slug,
    icon: overrides.slug,
    status: 'connected',
    configuredIn: 'models.yml',
    models: [],
    ...overrides,
  };
}

beforeEach(() => {
  installDomGlobals(new Window());
  container = document.createElement('div');
  document.body.appendChild(container);
  pressed = [];
});

afterEach(() => {
  render(null, container);
  container.remove();
  restoreDomGlobals();
});

function mount(item: ProviderItem): void {
  act(() => {
    render(
      h(ProviderAuthSection, {
        provider: item,
        onConnect: (kind: 'login' | 'edit') => pressed.push(kind),
        onToggleDisabled: () => {},
        onDelete: () => {},
        onSignOut: () => {},
      }),
      container,
    );
  });
}

function button(label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find(
    (node) => node.textContent?.trim() === label,
  ) as HTMLButtonElement | undefined;
}

describe('ProviderAuthSection connection controls', () => {
  test('a provider that is BOTH an OAuth login and a file entry offers both', () => {
    mount(provider({ slug: 'anthropic', oauth: true, inModelsYml: true, auth: 'oauth' }));

    expect(button('sign in')).toBeDefined();
    expect(button('edit')).toBeDefined();
    expect(button('connect')).toBeUndefined();
  });

  test('an already-signed-in provider says so on the login button', () => {
    // The control is still a LOGIN (a token can lapse); the label only stops
    // claiming the provider is signed out when it is not.
    mount(provider({ slug: 'anthropic', oauth: true, inModelsYml: true, auth: 'oauth', credentialOrigin: 'login' }));

    expect(button('sign in again')).toBeDefined();
    expect(button('sign in')).toBeUndefined();
    expect(button('edit')).toBeDefined();
  });

  test('each button routes to its own dialog', () => {
    mount(provider({ slug: 'anthropic', oauth: true, inModelsYml: true, auth: 'oauth' }));

    act(() => button('sign in')?.click());
    act(() => button('edit')?.click());
    expect(pressed).toEqual(['login', 'edit']);
  });

  test('a file entry alone offers edit and no sign-in', () => {
    mount(provider({ slug: 'gateway', inModelsYml: true, credentialOrigin: 'models.yml' }));

    expect(button('edit')).toBeDefined();
    expect(button('sign in')).toBeUndefined();
  });

  test('an OAuth provider with no entry offers sign-in and no edit', () => {
    mount(provider({ slug: 'copilot', oauth: true, status: 'disconnected' }));

    expect(button('sign in')).toBeDefined();
    expect(button('edit')).toBeUndefined();
  });

  test('a discovered provider has neither, and the disabled button says why', () => {
    mount(provider({ slug: 'web' }));

    const connect = button('connect');
    expect(connect?.disabled).toBe(true);
    expect(connect?.title).toContain('discovers this provider');
  });

  test('sign out is offered only for a stored credential', () => {
    mount(provider({ slug: 'a', oauth: true, credentialOrigin: 'login' }));
    expect(button('sign out')).toBeDefined();

    render(null, container);
    mount(provider({ slug: 'b', inModelsYml: true, credentialOrigin: 'models.yml' }));
    // A models.yml key is removed by clearing the field in the editor.
    expect(button('sign out')).toBeUndefined();

    render(null, container);
    mount(provider({ slug: 'c', credentialOrigin: 'environment' }));
    expect(button('sign out')).toBeUndefined();
  });
});
