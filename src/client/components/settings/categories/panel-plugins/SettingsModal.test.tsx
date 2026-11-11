/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The schema-driven settings form.
 *
 * The load-bearing cases are the two a visual check cannot see: a secret is
 * never prefilled and is left OUT of the request when untouched (sending the
 * mask back would overwrite the credential), and a number field is sent as a
 * number rather than the string the input holds.
 *
 * Rendered with `h()` against happy-dom, following the panel suites.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { PluginSettingsModal } from '@/client/components/settings/categories/panel-plugins/SettingsModal';
import { PLUGIN_SECRET_MASK } from '@/shared/lib/plugins/settings';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let container: HTMLElement;
const nativeFetch = globalThis.fetch;

const DEFINITIONS = {
  note: { type: 'string', label: 'Note prefix', description: 'Prepended to every note.' },
  retries: { type: 'number', label: 'Retries' },
  verbose: { type: 'boolean', label: 'Verbose' },
  token: { type: 'string', label: 'API token', secret: true },
};

const VALUES = { note: 'hello', retries: 3, verbose: false, token: PLUGIN_SECRET_MASK };

interface Sent {
  url: string;
  method: string;
  body: unknown;
}

let sent: Sent[] = [];

/** The one shape the component sends. */
function isValuesBody(body: unknown): body is { values: Record<string, unknown> } {
  if (typeof body !== 'object' || body === null || !('values' in body)) return false;
  const values = body.values;
  return typeof values === 'object' && values !== null;
}

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterEach(() => {
  if (container) render(null, container);
  globalThis.fetch = nativeFetch;
  sent = [];
});

afterAll(() => {
  restoreDomGlobals();
});

function stubFetch() {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    sent.push({ url, method, body });
    const values = method === 'PUT' && isValuesBody(body) ? { ...VALUES, ...body.values } : VALUES;
    return new Response(JSON.stringify({ pluginId: 'demo', definitions: DEFINITIONS, values }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

async function mount(): Promise<HTMLElement> {
  stubFetch();
  container = document.createElement('div');
  document.body.append(container);
  await act(async () => {
    render(h(PluginSettingsModal, { pluginId: 'demo', name: 'Demo', onClose: () => {} }), container);
  });
  await flush();
  return container;
}

/** Let the fetch promise chain settle; each `await` in the component is a tick. */
async function flush(): Promise<void> {
  for (let tick = 0; tick < 6; tick += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function input(el: HTMLElement, label: string): HTMLInputElement {
  const field = el.querySelector<HTMLInputElement>(`#plugin-setting-${label}`);
  if (!field) throw new Error(`no input for ${label}`);
  return field;
}

describe('PluginSettingsModal', () => {
  test('renders one control per definition, from the schema', async () => {
    const el = await mount();
    expect(el.textContent).toContain('Note prefix');
    expect(el.textContent).toContain('Prepended to every note.');
    expect(input(el, 'note').value).toBe('hello');
    expect(input(el, 'retries').value).toBe('3');
    expect(input(el, 'verbose').checked).toBe(false);
  });

  test('a stored secret starts empty and says it is stored', async () => {
    const el = await mount();
    const token = input(el, 'token');
    expect(token.type).toBe('password');
    expect(token.value).toBe('');
    expect(token.getAttribute('placeholder')).toContain('stored');
  });

  test('saves typed values, sends numbers as numbers, and omits an untouched secret', async () => {
    const el = await mount();

    const note = input(el, 'note');
    await act(async () => {
      note.value = 'changed';
      note.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const save = Array.from(el.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Save');
    if (!save) throw new Error('no Save button');
    await act(async () => {
      save.click();
    });
    await flush();

    const put = sent.find((request) => request.method === 'PUT');
    expect(put?.url).toBe('/api/panels/settings/demo');
    expect(put?.body).toEqual({ values: { note: 'changed', retries: 3, verbose: false } });
    expect(el.textContent).toContain('Saved');
  });

  test('a typed secret replaces the stored one', async () => {
    const el = await mount();

    const token = input(el, 'token');
    await act(async () => {
      token.value = 'new-token';
      token.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const save = Array.from(el.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Save');
    if (!save) throw new Error('no Save button');
    await act(async () => {
      save.click();
    });
    await flush();

    const put = sent.find((request) => request.method === 'PUT');
    expect(put && isValuesBody(put.body) ? put.body.values.token : undefined).toBe('new-token');
  });
});
