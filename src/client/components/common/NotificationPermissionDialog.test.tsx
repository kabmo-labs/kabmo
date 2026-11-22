/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The awareness dialog: a grant the user asked for but the system refuses must
 * not be invisible.
 *
 * The failure it pins was silent end to end — the switches read "on", the server
 * recorded the event, the shell posted it, and macOS dropped banner and chime
 * alike (`authorizationStatus: Denied`, `Presenting … as none`). The only gate
 * that may keep this dialog away is "the user never asked for notifications".
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { NotificationPermissionDialog } from '@/client/components/common/NotificationPermissionDialog';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import { primeKabmoSettings } from '@/shared/lib/settings/client';

let container: HTMLElement | undefined;

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterEach(() => {
  primeKabmoSettings({});
  delete window.__kabmoCall;
  if (container) {
    render(null, container);
    container.remove();
    container = undefined;
  }
});

afterAll(() => {
  restoreDomGlobals();
});

function tick(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 0);
  return promise;
}

type Call = { method: string; params?: Record<string, unknown> };

/** A shell with the given grant, recording every command the page sends. */
function shellAnswering(
  status: string,
  extra: (call: Call) => unknown = () => null,
): Call[] {
  const calls: Call[] = [];
  window.__kabmoCall = (method, params) => {
    const call = { method, params };
    calls.push(call);
    if (method === 'notification_state') return Promise.resolve({ status, canOpenSettings: true });
    return Promise.resolve(extra(call));
  };
  return calls;
}

async function mount(): Promise<HTMLElement> {
  const host = document.createElement('div');
  container = host;
  document.body.append(host);
  act(() => {
    render(h(NotificationPermissionDialog, {}), host);
  });
  await act(async () => {
    await tick();
  });
  return host;
}

function buttonNamed(text: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll('button')].find(
    (button) => button.textContent === text,
  ) as HTMLButtonElement | undefined;
}

describe('NotificationPermissionDialog', () => {
  test('a denied grant on an active device is stated, with the screen that fixes it', async () => {
    primeKabmoSettings({ notifyOnFinish: true });
    const calls = shellAnswering('denied');

    const host = await mount();
    expect(host.ownerDocument.body.textContent).toContain('Notifications are turned off');
    // ONE way out: the shell's named close control. The footer used to repeat it
    // as "Not now", which ran the same handler — two controls, one action.
    expect(host.ownerDocument.body.textContent).not.toContain('Not now');
    expect(document.querySelector('button[aria-label="Close"]')).not.toBeNull();

    act(() => buttonNamed('Open system settings')?.click());
    expect(calls.map((call) => call.method)).toContain('notification_settings_open');
  });

  test('a never-asked grant offers the prompt instead of the settings screen', async () => {
    primeKabmoSettings({ notifyOnAsk: true });
    const calls = shellAnswering('notDetermined', (call) =>
      call.method === 'notification_request' ? { granted: true } : null,
    );

    await mount();
    act(() => buttonNamed('Allow notifications')?.click());
    await act(async () => {
      await tick();
    });

    expect(calls.map((call) => call.method)).toContain('notification_request');
    // Granted: the dialog has no reason to stay.
    expect(document.body.textContent).not.toContain('Notifications are turned off');
  });

  test('a refusal inside the prompt turns the dialog into the settings case', async () => {
    primeKabmoSettings({ notifyOnAsk: true });
    shellAnswering('notDetermined', (call) =>
      call.method === 'notification_request' ? { granted: false } : null,
    );

    await mount();
    act(() => buttonNamed('Allow notifications')?.click());
    await act(async () => {
      await tick();
    });

    expect(buttonNamed('Open system settings')).toBeDefined();
  });

  test('the close control dismisses it without touching the grant', async () => {
    primeKabmoSettings({ notifyOnError: true });
    const calls = shellAnswering('denied');

    await mount();
    const close = document.querySelector<HTMLButtonElement>('button[aria-label="Close"]');
    expect(close).not.toBeNull();
    act(() => close?.click());

    expect(document.body.textContent).not.toContain('Notifications are turned off');
    expect(calls.map((call) => call.method)).not.toContain('notification_request');
  });

  test('every event off means nothing to be aware of', async () => {
    primeKabmoSettings({});
    shellAnswering('denied');

    await mount();
    expect(document.body.textContent).not.toContain('Notifications are turned off');
  });

  test("this device's delivery master off silences the dialog too", async () => {
    primeKabmoSettings({ notifyOnFinish: true, notifyDesktopEnabled: false, notifyMobileEnabled: false });
    shellAnswering('denied');

    await mount();
    expect(document.body.textContent).not.toContain('Notifications are turned off');
  });

  test('an unknown grant is not a refusal and shows nothing', async () => {
    primeKabmoSettings({ notifyOnFinish: true });
    window.__kabmoCall = () => Promise.reject(new Error('This shell does not support notification_state.'));

    await mount();
    expect(document.body.textContent).not.toContain('Notifications are turned off');
  });
});
