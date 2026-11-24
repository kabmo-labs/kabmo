/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Settings → Voice → Speech, rendered.
 *
 * The page writes ONE field of the `tts` object per choice (the modal persists
 * the diff, so a whole-object echo would let a stale tab win), and a local
 * engine that cannot run says why instead of looking healthy.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { SpeechSettings } from '@/client/components/settings/categories/voice-settings/SpeechSettings';
import { DEFAULT_SETTINGS } from '@/shared/lib/settings/defaults';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { SettingsState } from '@/shared/types';

let container: HTMLElement | undefined;
const originalFetch = globalThis.fetch;

type Updater = Partial<SettingsState> | ((prev: SettingsState) => SettingsState);

function stubServer(local: { available: boolean; reason?: string } = { available: true }): void {
  globalThis.fetch = (async () => Response.json({
    settings: { ...DEFAULT_SETTINGS.tts, hasKeys: {} },
    local,
  })) as unknown as typeof fetch;
}

function mount(onUpdate: (updater: Updater) => void, overrides: Partial<SettingsState['tts']> = {}): HTMLElement {
  const host = document.createElement('div');
  container = host;
  document.body.append(host);
  act(() => {
    render(h(SpeechSettings, {
      settings: {
        ...DEFAULT_SETTINGS,
        tts: { ...DEFAULT_SETTINGS.tts, ...overrides },
      },
      onUpdate,
    }), host);
  });
  return host;
}

function clickText(host: HTMLElement, text: string): void {
  const button = [...host.querySelectorAll('button, [role="button"]')].find((element) =>
    element.textContent?.includes(text),
  );
  expect(button, `no control containing "${text}"`).toBeDefined();
  act(() => {
    (button as HTMLElement).dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
}

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (container) {
    render(null, container);
    container.remove();
    container = undefined;
  }
});

afterAll(() => restoreDomGlobals());

describe('SpeechSettings', () => {
  test('choosing an engine writes only the tts object', () => {
    stubServer();
    let patch: Updater | undefined;
    const host = mount((updater) => { patch = updater; });

    clickText(host, 'OpenAI-compatible API');

    expect(patch).toEqual({
      tts: { ...DEFAULT_SETTINGS.tts, engine: 'openai' },
    });
  });

  test('autoplay is one boolean on the same object', () => {
    stubServer();
    let patch: Updater | undefined;
    const host = mount((updater) => { patch = updater; });

    const checkbox = host.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    act(() => checkbox.click());

    expect(patch).toEqual({
      tts: { ...DEFAULT_SETTINGS.tts, autoplay: true },
    });
  });

  test('an unavailable local engine states the reason', async () => {
    stubServer({ available: false, reason: 'This omp build has no say command.' });
    const host = mount(() => {}, { engine: 'omp' });
    await act(async () => {
      await Bun.sleep(0);
    });
    expect(host.textContent).toContain('This omp build has no say command.');
  });
});
