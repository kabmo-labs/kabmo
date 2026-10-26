/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The console's half of the shell's Settings › row.
 *
 * `useSettingsModal` is what a desktop layout gives the modal, and it is driven
 * from two places: the sidebar footer's button and the `omp:open-settings`
 * window event. The event is the ONLY path a native shell has — the macOS menu
 * row dispatches it (`PageEvents.swift`), and the Linux one sends the same
 * string — so the hook must open the modal from it, adopt the category the
 * caller asked for, and carry the provider dialog request.
 *
 * The failure this pins is silent in both directions: a hook that never
 * subscribed leaves the menu row doing nothing on screen, and a hook that
 * opened the modal WITHOUT the requested category lands the user on Appearance
 * when they asked for Providers.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { useSettingsModal } from '@/client/hooks/ui/settings-modal';
import type { SettingsModalState } from '@/client/hooks/ui/settings-modal';

const DOM_GLOBALS = ['window', 'document', 'Event', 'CustomEvent', 'HTMLElement', 'Node', 'Element'] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

let container: HTMLElement | null = null;

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in nativeGlobals)) nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) target[key] = nativeGlobals[key];
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
  container = null;
});

async function mount(): Promise<{ current: SettingsModalState }> {
  const box: { current: SettingsModalState } = { current: null as never };
  function Probe() {
    box.current = useSettingsModal();
    return null;
  }
  container ??= document.body.appendChild(document.createElement('div'));
  await act(async () => {
    render(h(Probe, null), container as HTMLElement);
  });
  return box;
}

/** Dispatch the way a shell does: a `CustomEvent` carrying a detail record. */
async function shellOpensSettings(detail: Record<string, unknown>): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new CustomEvent('omp:open-settings', { detail }));
  });
}

describe('useSettingsModal', () => {
  test('a closed modal is the starting state', async () => {
    const box = await mount();
    expect(box.current.isOpen).toBe(false);
  });

  test("the shell's event opens it", async () => {
    const box = await mount();
    await shellOpensSettings({});
    expect(box.current.isOpen).toBe(true);
  });

  test('the requested category is adopted, not replaced by the default', async () => {
    const box = await mount();
    await shellOpensSettings({ category: 'providers' });
    expect(box.current.isOpen).toBe(true);
    expect(box.current.category).toBe('providers');
  });

  test('the provider dialog request rides along', async () => {
    const box = await mount();
    await shellOpensSettings({ category: 'providers', autoOpenAdd: true });
    expect(box.current.autoOpenAddProvider).toBe(true);
  });

  test('closing clears the provider request, so the next open is a plain one', async () => {
    const box = await mount();
    await shellOpensSettings({ autoOpenAdd: true });
    await act(async () => box.current.close());
    expect(box.current.isOpen).toBe(false);
    expect(box.current.autoOpenAddProvider).toBe(false);
  });

  test('unmounting drops the listener', async () => {
    const box = await mount();
    render(null, container as HTMLElement);
    container = null;
    await shellOpensSettings({});
    expect(box.current.isOpen).toBe(false);
  });
});
