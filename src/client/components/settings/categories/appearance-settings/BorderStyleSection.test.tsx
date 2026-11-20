/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * "Rules" — the two hairline cards.
 *
 * The card is the only place the setting can be READ as a choice, so what is
 * pinned here is the pair of promises it makes in markup: the selected style is
 * the one the stored value resolves to (an unknown value must not leave both
 * cards unpressed), and clicking a card asks for THAT style rather than for a
 * toggle — a second click on the active card must not flip the shell.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { BorderStyleSection } from '@/client/components/settings/categories/appearance-settings/BorderStyleSection';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
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
  borderStyle: string,
  onUpdate: (patch: Partial<SettingsState>) => void = () => {},
): HTMLElement {
  container = document.body.appendChild(document.createElement('div'));
  act(() =>
    render(
      h(BorderStyleSection, {
        settings: { borderStyle } as SettingsState,
        onUpdate: onUpdate as SettingsState extends never ? never : SettingsSectionOnUpdate,
      }),
      container,
    ),
  );
  return container;
}

const cards = (el: HTMLElement) => [...el.querySelectorAll('button[aria-pressed]')] as HTMLButtonElement[];

describe('border style section', () => {
  test('both styles are offered, with the shipped one selected by default', () => {
    const el = mount('hairline');
    const found = cards(el);

    expect(found.map((card) => card.textContent?.includes('Hairline'))).toEqual([true, false]);
    expect(found.map((card) => card.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
  });

  test('a stored borderless style presses the borderless card', () => {
    const found = cards(mount('borderless'));

    expect(found[0].getAttribute('aria-pressed')).toBe('false');
    expect(found[1].getAttribute('aria-pressed')).toBe('true');
  });

  test('an unknown stored value falls to hairline rather than leaving both unpressed', () => {
    const found = cards(mount('naked'));

    expect(found[0].getAttribute('aria-pressed')).toBe('true');
  });

  test('clicking a card asks for that style, even when it is already active', () => {
    const asked: Partial<SettingsState>[] = [];
    const found = cards(mount('borderless', (patch) => asked.push(patch)));

    act(() => found[1].click());
    act(() => found[1].click());

    // A toggle would have produced `hairline` on the second click and silently
    // changed the shell from a card the user clicked to KEEP.
    expect(asked).toEqual([{ borderStyle: 'borderless' }, { borderStyle: 'borderless' }]);
  });

  test('the borderless card says the fields and switches keep their edge', () => {
    const el = mount('hairline');
    const borderless = cards(el)[1];

    expect(borderless.textContent).toContain('Fields and switches keep their edge');
  });
});
