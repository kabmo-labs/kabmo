/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The three system-notification preferences.
 *
 * They ship FALSE, and the UI is where that promise becomes a user-visible
 * fact: a default of `true` would show three switches already on, and the first
 * agent run would ask the OS for permission nobody chose. The toggle must also
 * write ONE key — the settings modal persists the diff, so a handler that
 * touched the others would republish values the user never changed.
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

describe('NotificationSettings', () => {
  test('the three system toggles are off on a fresh install', () => {
    mount(() => {});
    // The sound switch is first and keeps its shipped-on default; the three
    // system preferences follow it.
    const system = switches().slice(1);
    expect(system).toHaveLength(3);
    for (const toggle of system) expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  test('turning Run finished on writes only that key', () => {
    const updates: Updater[] = [];
    mount((update) => updates.push(update));
    const finish = switches().find((toggle) => toggle.getAttribute('aria-label')?.includes('Run finished'));
    expect(finish).toBeDefined();

    act(() => {
      finish?.click();
    });
    expect(updates).toEqual([{ notifyOnFinish: true }]);
  });

  test('turning Waiting for you on writes its own key', () => {
    const updates: Updater[] = [];
    mount((update) => updates.push(update));
    const ask = switches().find((toggle) => toggle.getAttribute('aria-label')?.includes('Waiting for you'));

    act(() => {
      ask?.click();
    });
    expect(updates).toEqual([{ notifyOnAsk: true }]);
  });
});
