/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Usage panel's "hide providers without quota" preference.
 *
 * Two things a wrong implementation gets silently:
 *
 * - Only the literal boolean `true` hides. `app_settings` stores a scalar as
 *   TEXT (`writeSettingsRaw` holds `String(value)`), and the reader JSON-parses
 *   it with the raw string as the fallback, so a truthiness test would hide the
 *   panel's empty rows for a hand-written `"yes"` no one ever toggled.
 * - The write is the shared top-level patch (`writeSetting`), the route the
 *   sidebar's width takes. A blob write would republish keys this page only
 *   read, which is what drops a preference another tab changed meanwhile.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import {
  HIDE_EMPTY_PROVIDERS_SETTING_KEY,
  currentHideEmptyProviders,
  useHideEmptyProviders,
} from '@/client/hooks/settings/hide-empty-providers';
import { primeKabmoSettings, readKabmoSetting } from '@/shared/lib/settings/client';

const DOM_GLOBALS = ['window', 'document', 'fetch'] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};
/** Every settings patch the hook POSTed, in order. */
let posts: Record<string, unknown>[] = [];

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in nativeGlobals)) nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
  target.fetch = (async (_input: unknown, init?: RequestInit) => {
    posts.push(JSON.parse(String(init?.body ?? '{}')));
    return Response.json({ success: true });
  }) as unknown as typeof fetch;
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) target[key] = nativeGlobals[key];
});

afterEach(() => {
  posts = [];
  primeKabmoSettings({});
});

/** The panel's own control, reduced to what this module owns. */
function Toggle() {
  const [hide, setHide] = useHideEmptyProviders();
  return h('button', { 'aria-pressed': String(hide), onClick: () => setHide(!hide) }, 'toggle');
}

async function mountToggle(): Promise<{ container: HTMLElement; button: HTMLButtonElement }> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => render(h(Toggle, {}), container));
  const button = container.querySelector<HTMLButtonElement>('button');
  if (!button) throw new Error('the toggle did not render');
  return { container, button };
}

describe('currentHideEmptyProviders', () => {
  test('nothing stored means the empty rows are hidden', () => {
    expect(currentHideEmptyProviders()).toBe(true);
    expect(currentHideEmptyProviders({})).toBe(true);
  });

  test('only the literal false shows them again', () => {
    // The primed snapshot is what `readKabmoSetting` answers from at runtime, so
    // the boot payload is how a stored value reaches this predicate.
    primeKabmoSettings({ [HIDE_EMPTY_PROVIDERS_SETTING_KEY]: false });
    expect(currentHideEmptyProviders()).toBe(false);
    primeKabmoSettings({ [HIDE_EMPTY_PROVIDERS_SETTING_KEY]: true });
    expect(currentHideEmptyProviders()).toBe(true);
    // A stored scalar survives as the raw string when the row is not JSON, and
    // it must not flip the panel's default either way.
    primeKabmoSettings({ [HIDE_EMPTY_PROVIDERS_SETTING_KEY]: 'false' });
    expect(currentHideEmptyProviders()).toBe(true);
    primeKabmoSettings({ [HIDE_EMPTY_PROVIDERS_SETTING_KEY]: 'yes' });
    expect(currentHideEmptyProviders()).toBe(true);
  });
});

describe('useHideEmptyProviders', () => {
  test('a fresh install renders the control already pressed', async () => {
    const { container, button } = await mountToggle();
    expect(button.getAttribute('aria-pressed')).toBe('true');

    await act(async () => render(null, container));
    container.remove();
  });

  test('a stored false is drawn on the first render, with no flash of the default', async () => {
    primeKabmoSettings({ [HIDE_EMPTY_PROVIDERS_SETTING_KEY]: false });
    const { container, button } = await mountToggle();
    expect(button.getAttribute('aria-pressed')).toBe('false');

    await act(async () => render(null, container));
    container.remove();
  });

  test('showing the empty rows persists the literal false under the top-level key', async () => {
    const { container, button } = await mountToggle();

    await act(async () => button.click());
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(posts).toEqual([{ [HIDE_EMPTY_PROVIDERS_SETTING_KEY]: false }]);
    expect(readKabmoSetting(HIDE_EMPTY_PROVIDERS_SETTING_KEY)).toBe(false);

    await act(async () => button.click());
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(posts).toEqual([
      { [HIDE_EMPTY_PROVIDERS_SETTING_KEY]: false },
      { [HIDE_EMPTY_PROVIDERS_SETTING_KEY]: true },
    ]);

    await act(async () => render(null, container));
    container.remove();
  });
});
