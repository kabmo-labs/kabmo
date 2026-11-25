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

const SUPERTONIC = {
  id: 'supertonic-3',
  label: 'Supertonic 3',
  arch: 'supertonic',
  languages: ['en', 'id'],
  defaultLanguage: 'en',
  voices: 2,
  voiceLabels: ['Female 1', 'Male 1'],
  sampleRate: 44100,
  sizeBytes: 146_000_000,
};

function stubServer(
  local: { available: boolean; reason?: string } = { available: true },
  models: Record<string, unknown> = { models: [], catalog: [], jobs: [], runtime: { available: true } },
): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
    if (url.includes('/api/tts/models')) return Response.json(models);
    return Response.json({ settings: { ...DEFAULT_SETTINGS.tts, hasKeys: {} }, local });
  }) as unknown as typeof fetch;
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

  test('a hosted engine offers Indonesian and writes it to the tts object', () => {
    stubServer();
    let patch: Updater | undefined;
    const host = mount((updater) => { patch = updater; }, { engine: 'openai' });

    const label = [...host.querySelectorAll('label')].find((element) =>
      element.textContent?.includes('Language'),
    );
    const select = label?.querySelector('select') as HTMLSelectElement | null;
    expect(select).not.toBeNull();
    expect([...select!.options].map((option) => option.value)).toContain('id');

    act(() => {
      select!.value = 'id';
      select!.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    expect(patch).toEqual({
      tts: { ...DEFAULT_SETTINGS.tts, engine: 'openai', language: 'id' },
    });
  });

  test('Gemini states automatic language and hides the fixed speed control', () => {
    stubServer();
    const host = mount(() => {}, { engine: 'gemini' });
    expect(host.textContent).toContain('Google Gemini TTS');
    expect(host.textContent).toContain('Detects the answer’s language automatically');
    expect(host.textContent).not.toContain('1 is normal');
  });

  test('the ONNX engine lists the installed model, its voices and its languages', async () => {
    stubServer({ available: true }, { models: [SUPERTONIC], catalog: [], jobs: [], runtime: { available: true } });
    const host = mount(() => {}, { engine: 'local' });
    await act(async () => {
      await Bun.sleep(0);
    });

    expect(host.textContent).toContain('Local models');
    expect(host.textContent).toContain('Supertonic 3');
    expect(host.textContent).toContain('2 languages');
    expect(host.textContent).toContain('speaks Indonesian');

    // The language picker is the MODEL's list: English and Indonesian, no auto.
    const language = [...host.querySelectorAll('label')].find((element) =>
      element.textContent?.includes('Language'),
    )?.querySelector('select') as HTMLSelectElement | null;
    expect([...language!.options].map((option) => option.value)).toEqual(['', 'en', 'id']);

    // And the voice picker uses the model's named voices, not free text.
    const voice = [...host.querySelectorAll('label')].find((element) =>
      element.textContent?.includes('Voice') && !element.textContent?.includes('Voice and rate'),
    )?.querySelector('select') as HTMLSelectElement | null;
    expect([...voice!.options].map((option) => option.textContent)).toEqual(['Female 1', 'Male 1']);
  });

  test('a model that declares no languages says the code passes through', async () => {
    stubServer({ available: true }, {
      models: [{ ...SUPERTONIC, id: 'pasted', label: 'Pasted bundle', languages: [] }],
      catalog: [],
      jobs: [],
      runtime: { available: true },
    });
    const host = mount(() => {}, { engine: 'local', model: 'pasted' });
    await act(async () => {
      await Bun.sleep(0);
    });
    expect(host.textContent).toContain('declares no languages');
  });

  test('a model id that no longer exists repairs itself to the installed list', async () => {
    stubServer({ available: true }, { models: [SUPERTONIC], catalog: [], jobs: [], runtime: { available: true } });
    let patch: Updater | undefined;
    mount((updater) => { patch = updater; }, { engine: 'local', model: 'removed-model', voice: '3' });
    await act(async () => {
      await Bun.sleep(0);
    });
    expect(patch).toEqual({
      tts: { ...DEFAULT_SETTINGS.tts, engine: 'local', model: '', voice: '' },
    });
  });

  test('an empty model setting marks the first installed model as in use', async () => {
    stubServer({ available: true }, { models: [SUPERTONIC], catalog: [], jobs: [], runtime: { available: true } });
    const host = mount(() => {}, { engine: 'local' });
    await act(async () => {
      await Bun.sleep(0);
    });
    expect(host.textContent).toContain('In use');
  });

  test('an unavailable ONNX runtime states the reason on the card', async () => {
    stubServer({ available: true }, {
      models: [],
      catalog: [],
      jobs: [],
      runtime: { available: false, reason: 'The ONNX speech runtime could not load.' },
    });
    const host = mount(() => {}, { engine: 'local' });
    await act(async () => {
      await Bun.sleep(0);
    });
    expect(host.textContent).toContain('The ONNX speech runtime could not load.');
  });

  test('an engine with no Indonesian voice says which engines do', () => {
    stubServer();
    const omp = mount(() => {}, { engine: 'omp' });
    expect(omp.textContent).toContain('local voices are English');
    render(null, omp);
    omp.remove();

    const deepgram = mount(() => {}, { engine: 'deepgram' });
    expect(deepgram.textContent).toContain('no Indonesian voice');
  });
});
