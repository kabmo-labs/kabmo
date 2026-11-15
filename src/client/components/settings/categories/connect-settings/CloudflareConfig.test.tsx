/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The config-path field's one contract: the server is not asked to save a path
 * the user has not changed, and what it is asked to save is the trimmed text.
 *
 * The save is the failure point that matters — a button that fires on every
 * keystroke would rewrite `app_settings` while the user is still typing.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { CloudflareConfig } from '@/client/components/settings/categories/connect-settings/CloudflareConfig';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let win: Window;
let container: HTMLElement | null = null;

beforeAll(() => {
  win = new Window({ url: 'http://localhost:3000' });
  installDomGlobals(win);
});

afterEach(() => {
  if (container) {
    render(null, container);
    container.remove();
  }
  container = null;
  document.body.replaceChildren();
});

afterAll(() => {
  restoreDomGlobals();
});

function mount(path: string, onSave: (next: string) => void): HTMLButtonElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  container = host;
  act(() => {
    render(h(CloudflareConfig, { path, busy: false, onSave }), host);
  });
  const button = [...document.querySelectorAll('button')].find((node) => node.textContent === 'Save');
  if (!button) throw new Error('Save button not found');
  return button as HTMLButtonElement;
}

function input(): HTMLInputElement {
  const field = document.querySelector('input');
  if (!field) throw new Error('input not found');
  return field as HTMLInputElement;
}

describe('CloudflareConfig', () => {
  test('shows the effective path and saves nothing while it is unchanged', () => {
    const saved: string[] = [];
    const button = mount('/home/me/.cloudflared/config.yml', (next) => saved.push(next));

    expect(input().value).toBe('/home/me/.cloudflared/config.yml');
    expect(button.disabled).toBe(true);
    act(() => button.click());
    expect(saved).toEqual([]);
  });

  test('saves the trimmed path once the field changes', async () => {
    const saved: string[] = [];
    const button = mount('/home/me/.cloudflared/config.yml', (next) => saved.push(next));

    await act(async () => {
      input().value = '  /srv/tunnels/kabmo.yml  ';
      input().dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(button.disabled).toBe(false);
    act(() => button.click());
    expect(saved).toEqual(['/srv/tunnels/kabmo.yml']);
  });
});
