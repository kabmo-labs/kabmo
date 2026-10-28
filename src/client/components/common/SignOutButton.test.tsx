/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The sign-out control both layouts draw.
 *
 * Three properties matter, and each is invisible to a markup snapshot:
 *
 *   1. It appears only when there is a session to end — a password in force AND
 *      this browser holding one. An instance running open has nothing to sign
 *      out of, so drawing it there advertises a protection it does not have.
 *   2. The first press CONFIRMS and the second signs out. The control sits next
 *      to the reload button, and a single stray click costs a password retype.
 *   3. The confirmation is a state of the same button, so a keyboard user
 *      confirms without moving focus.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { SignOutButton } from '@/client/components/common/SignOutButton';
import { markAuthRequired, markAuthenticated, primeAuthState } from '@/client/hooks/ui/auth';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let win: Window;
let container: HTMLElement | null = null;
let logoutCalls = 0;
let reloads = 0;
const originalFetch = globalThis.fetch;

beforeAll(() => {
  win = new Window({ url: 'http://localhost' });
  installDomGlobals(win);
  win.location.reload = () => {
    reloads += 1;
  };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (String(input).includes('/api/auth/logout')) logoutCalls += 1;
    return new Response('{"success":true}', { status: 200 });
  }) as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  if (container) {
    const mounted = container;
    render(null, mounted);
    mounted.remove();
  }
  container = null;
  logoutCalls = 0;
  reloads = 0;
  markAuthenticated();
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  restoreDomGlobals();
});

function mount(node: h.JSX.Element): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  container = host;
  act(() => render(node, host));
  return host;
}

const button = (el: HTMLElement) => el.querySelector('button');

describe('SignOutButton', () => {
  test('is absent on an instance running open', () => {
    // `authenticated: true` for everyone, but there is no password to drop.
    primeAuthState(true, false);
    const el = mount(h(SignOutButton, { className: 'p-1' }));
    expect(button(el)).toBeNull();
  });

  test('is absent on the login screen, where there is no session yet', () => {
    primeAuthState(false, true);
    const el = mount(h(SignOutButton, { className: 'p-1' }));
    expect(button(el)).toBeNull();
  });

  test('appears once a protected instance has a session', () => {
    primeAuthState(true, true);
    const el = mount(h(SignOutButton, { className: 'p-1' }));
    const el2 = button(el);
    expect(el2).not.toBeNull();
    expect(el2?.getAttribute('aria-label')).toBe('Sign out');
    expect(el2?.getAttribute('title')).toBe('Sign out');
  });

  test('the first press confirms and does NOT sign out', () => {
    primeAuthState(true, true);
    const el = mount(h(SignOutButton, { className: 'p-1' }));
    act(() => {
      button(el)?.dispatchEvent(new Event('click', { bubbles: true }));
    });
    expect(logoutCalls).toBe(0);
    expect(button(el)?.getAttribute('aria-label')).toBe('Confirm sign out');
    expect(button(el)?.getAttribute('aria-expanded')).toBe('true');
    expect(button(el)?.getAttribute('title')).toBe('Click again to sign out');
  });

  test('the second press signs out', async () => {
    primeAuthState(true, true);
    const el = mount(h(SignOutButton, { className: 'p-1' }));
    act(() => {
      button(el)?.dispatchEvent(new Event('click', { bubbles: true }));
    });
    await act(async () => {
      button(el)?.dispatchEvent(new Event('click', { bubbles: true }));
    });
    expect(logoutCalls).toBe(1);
  });

  test('a pending confirmation is dropped when the session ends elsewhere', () => {
    primeAuthState(true, true);
    const el = mount(h(SignOutButton, { className: 'p-1' }));
    act(() => {
      button(el)?.dispatchEvent(new Event('click', { bubbles: true }));
    });
    expect(button(el)?.getAttribute('aria-expanded')).toBe('true');

    // Another tab signed out, or the session expired: the control disappears
    // rather than offering an action for a session that no longer exists.
    act(() => markAuthRequired());
    expect(button(el)).toBeNull();
  });

  test('keeps the caller class, so each layout sizes its own hit area', () => {
    primeAuthState(true, true);
    const el = mount(h(SignOutButton, { className: 'w-8 h-8', size: 18 }));
    expect(button(el)?.getAttribute('class')).toBe('w-8 h-8');
    expect(button(el)?.querySelector('svg')?.getAttribute('width')).toBe('18');
  });
});
