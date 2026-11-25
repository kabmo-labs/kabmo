/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * "Right side" — the side's closed state, per chat or everywhere.
 *
 * The failure this pins is a card pair that reads as a toggle: the default must
 * be the per-chat answer (the pre-setting behaviour), and clicking a card must
 * ask for THAT scope rather than flip the current one, or a second click on the
 * active card would silently change how every other chat behaves.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { RightSideSection } from '@/client/components/settings/categories/appearance-settings/RightSideSection';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import { DEFAULT_SETTINGS } from '@/shared/lib/settings/defaults';
import type { RightSideHiddenScope } from '@/shared/lib/workspace/right-side-hidden';
import type { SettingsState } from '@/shared/types';

type SettingsSectionOnUpdate = (updater: Partial<SettingsState> | ((previous: SettingsState) => SettingsState)) => void;

let container: HTMLElement;

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
});

afterAll(() => {
  restoreDomGlobals();
});

function mount(
  scope: RightSideHiddenScope,
  onUpdate: (patch: Partial<SettingsState>) => void = () => {},
): HTMLElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  const settings: SettingsState = { ...DEFAULT_SETTINGS, rightSideHiddenScope: scope };
  act(() => {
    render(
      h(RightSideSection, {
        settings,
        onUpdate: onUpdate as SettingsSectionOnUpdate,
      }),
      container,
    );
  });
  return container;
}

const cards = (el: HTMLElement) =>
  [...el.querySelectorAll('button[aria-pressed]')] as HTMLButtonElement[];

describe('right side scope section', () => {
  test('the per-chat default is the selected card', () => {
    const root = mount('session');
    const [session, global] = cards(root);

    expect(session.getAttribute('aria-pressed')).toBe('true');
    expect(session.textContent).toContain('Per chat');
    expect(global.getAttribute('aria-pressed')).toBe('false');
    expect(global.textContent).toContain('All chats');
  });

  test('picking "All chats" asks for the global scope', () => {
    const patches: Partial<SettingsState>[] = [];
    const root = mount('session', (patch) => patches.push(patch));

    act(() => {
      cards(root)[1].click();
    });

    expect(patches).toEqual([{ rightSideHiddenScope: 'global' }]);
  });

  test('clicking the active card asks for the same scope rather than toggling', () => {
    const patches: Partial<SettingsState>[] = [];
    const root = mount('global', (patch) => patches.push(patch));

    act(() => {
      cards(root)[1].click();
    });

    expect(patches).toEqual([{ rightSideHiddenScope: 'global' }]);
  });
});
