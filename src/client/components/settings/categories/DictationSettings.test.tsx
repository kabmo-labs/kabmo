/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Settings → Dictation, rendered.
 *
 * Two promises the page makes to the user are structural, not stylistic: a
 * language choice writes ONE field of the dictation object (the modal persists
 * the diff, so a whole-object echo would let a stale tab win), and "detect
 * automatically" is disabled on the LOCAL engine — because that engine decodes a
 * missing language as English, which is the bug this page exists to make visible.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { DictationSettings } from '@/client/components/settings/categories/DictationSettings';
import { DEFAULT_SETTINGS } from '@/shared/lib/settings/defaults';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { SettingsState } from '@/shared/types';

let container: HTMLElement | undefined;
const originalFetch = globalThis.fetch;

type Updater = Partial<SettingsState> | ((prev: SettingsState) => SettingsState);

/** Answer the server-state read; record any write the page makes. */
function stubServer(hasApiKey = false): Array<{ url: string; body: unknown }> {
  const writes: Array<{ url: string; body: unknown }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'POST') {
      writes.push({ url, body: JSON.parse(String(init.body)) });
      return Response.json({ success: true, hasApiKey: true });
    }
    return Response.json({
      settings: { ...DEFAULT_SETTINGS.dictation, engine: 'omp', hasApiKey },
      local: { available: false, reason: 'the worker exited' },
    });
  }) as typeof fetch;
  return writes;
}

function mount(onUpdate: (updater: Updater) => void, settings: Partial<SettingsState> = {}): HTMLElement {
  const host = document.createElement('div');
  container = host;
  document.body.append(host);
  act(() => {
    render(h(DictationSettings, { settings: { ...DEFAULT_SETTINGS, ...settings }, onUpdate }), host);
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

afterAll(() => {
  restoreDomGlobals();
});

describe('DictationSettings', () => {
  test('choosing an engine writes only the dictation object', () => {
    stubServer();
    let patch: Updater | undefined;
    const host = mount((updater) => {
      patch = updater;
    });

    clickText(host, 'OpenAI-compatible API');

    expect(patch).toEqual({
      dictation: { ...DEFAULT_SETTINGS.dictation, engine: 'openai' },
    });
  });

  test('the language choice keeps the rest of the config intact', () => {
    stubServer();
    let patch: Updater | undefined;
    const host = mount((updater) => {
      patch = updater;
    });

    clickText(host, 'Indonesian');

    expect(patch).toEqual({
      dictation: { ...DEFAULT_SETTINGS.dictation, language: 'id' },
    });
  });

  test('“detect automatically” is disabled while the local engine is selected', () => {
    stubServer();
    const host = mount(() => {});
    const auto = [...host.querySelectorAll('button')].find((element) =>
      element.textContent?.includes('Detect automatically'),
    ) as HTMLButtonElement | undefined;

    expect(auto).toBeDefined();
    expect(auto?.disabled).toBe(true);
    expect(auto?.textContent).toContain('cannot detect a language');
  });

  test('with a hosted engine, auto is offered and the key field appears', () => {
    stubServer();
    const host = mount(() => {}, {
      dictation: { ...DEFAULT_SETTINGS.dictation, engine: 'deepgram' },
    });
    const auto = [...host.querySelectorAll('button')].find((element) =>
      element.textContent?.includes('Detect automatically'),
    ) as HTMLButtonElement | undefined;

    expect(auto?.disabled).toBe(false);
    expect(host.textContent).toContain('API key — none stored');
  });

  test('a stored key is reported without ever rendering one', async () => {
    stubServer(true);
    const host = mount(() => {}, {
      dictation: { ...DEFAULT_SETTINGS.dictation, engine: 'openai' },
    });
    // The page reads `hasApiKey` in an effect; one flush lets that land.
    await act(async () => {
      await Bun.sleep(0);
    });

    expect(host.textContent).toContain('API key — a key is stored');
    expect(host.querySelectorAll('input[type="password"]')).toHaveLength(1);
  });
});
