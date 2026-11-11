/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The system-notification preferences: two delivery switches and three events.
 *
 * The events ship FALSE, and the UI is where that promise becomes a
 * user-visible fact: a default of `true` would show three switches already on,
 * and the first agent run would ask the OS for permission nobody chose. The two
 * platform masters are the opposite — they ship ON so an install that already
 * opted into an event keeps receiving it — and every toggle must write ONE key,
 * because the settings modal persists the diff.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { NotificationSettings } from '@/client/components/settings/categories/NotificationSettings';
import { DEFAULT_SETTINGS } from '@/shared/lib/settings/defaults';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { SettingsState } from '@/shared/types';

let container: HTMLElement | undefined;

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterEach(() => {
  if (container) {
    render(null, container);
    container.remove();
    container = undefined;
  }
});

afterAll(() => {
  restoreDomGlobals();
});

type Updater = Partial<SettingsState> | ((prev: SettingsState) => SettingsState);

function mount(onUpdate: (updater: Updater) => void): HTMLElement {
  const host = document.createElement('div');
  container = host;
  document.body.append(host);
  act(() => {
    render(h(NotificationSettings, { settings: { ...DEFAULT_SETTINGS }, onUpdate }), host);
  });
  return host;
}

function switches(): HTMLElement[] {
  return [...document.querySelectorAll('[role="switch"]')] as HTMLElement[];
}

function switchNamed(label: string): HTMLElement | undefined {
  return switches().find((toggle) => toggle.getAttribute('aria-label')?.includes(label));
}

describe('NotificationSettings', () => {
  test('both delivery sections are on and the three events are off on a fresh install', () => {
    mount(() => {});
    // Sound, Desktop, Mobile, then the three event preferences.
    const [, desktop, mobile, ...events] = switches();
    expect(desktop.getAttribute('aria-checked')).toBe('true');
    expect(mobile.getAttribute('aria-checked')).toBe('true');
    expect(events).toHaveLength(3);
    for (const toggle of events) expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  test('disabling the Desktop section writes only its key', () => {
    const updates: Updater[] = [];
    mount((update) => updates.push(update));

    act(() => {
      switchNamed('Desktop notifications')?.click();
    });
    expect(updates).toEqual([{ notifyDesktopEnabled: false }]);
  });

  test('disabling the Mobile section writes only its key', () => {
    const updates: Updater[] = [];
    mount((update) => updates.push(update));

    act(() => {
      switchNamed('Mobile notifications')?.click();
    });
    expect(updates).toEqual([{ notifyMobileEnabled: false }]);
  });

  test('turning Run finished on writes only that key', () => {
    const updates: Updater[] = [];
    mount((update) => updates.push(update));
    const finish = switchNamed('Run finished');
    expect(finish).toBeDefined();

    act(() => {
      finish?.click();
    });
    expect(updates).toEqual([{ notifyOnFinish: true }]);
  });

  test('turning Waiting for you on writes its own key', () => {
    const updates: Updater[] = [];
    mount((update) => updates.push(update));

    act(() => {
      switchNamed('Waiting for you')?.click();
    });
    expect(updates).toEqual([{ notifyOnAsk: true }]);
  });
});
