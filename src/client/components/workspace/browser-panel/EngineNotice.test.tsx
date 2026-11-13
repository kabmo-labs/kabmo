/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The engine notice is the panel's only honest answer to a WebKit session.
 *
 * It has to name the engine, state the cost of switching, and offer the one
 * write that fixes it — a notice without the button leaves the user with a
 * dead panel and a config key to find by hand. These cases pin the copy, the
 * button's disabled state while the write is in flight, and the server's
 * refusal reaching the screen.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { BrowserEngineNotice } from '@/client/components/workspace/browser-panel/EngineNotice';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event'] as const;
const native: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};
let container: HTMLElement | undefined;

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in native)) native[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (native[key] === undefined) delete target[key];
    else target[key] = native[key];
  }
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
  container = undefined;
});

function mount(props: Partial<Parameters<typeof BrowserEngineNotice>[0]> = {}): HTMLElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    render(
      <BrowserEngineNotice
        saving={false}
        error={null}
        onUseChromium={() => {}}
        variant="body"
        {...props}
      />,
      container!,
    );
  });
  return container;
}

describe('BrowserEngineNotice', () => {
  test('names the engine and the reason the panel is empty', () => {
    const text = mount().textContent ?? '';
    expect(text).toContain('WebKit');
    expect(text).toContain('tidak bisa memantulkannya');
    expect(text).toContain('CDP');
  });

  test('states the cost of switching, not just the button', () => {
    const text = mount().textContent ?? '';
    expect(text).toContain('RAM');
    expect(text).toContain('Disk');
    expect(text).toContain('Deteksi');
  });

  test('the button performs the switch', () => {
    let calls = 0;
    const root = mount({ onUseChromium: () => { calls += 1; } });
    const button = root.querySelector('button');
    expect(button?.textContent).toContain('Pakai Chromium');
    act(() => button?.click());
    expect(calls).toBe(1);
  });

  test('a write in flight disables the button and says so', () => {
    const root = mount({ saving: true });
    const button = root.querySelector('button');
    expect(button?.disabled).toBe(true);
    expect(button?.textContent).toContain('Mengaktifkan');
  });

  test('the server refusal reaches the screen', () => {
    const text = mount({ error: 'config writes are unavailable in mock mode' }).textContent ?? '';
    expect(text).toContain('config writes are unavailable in mock mode');
  });

  test('the strip variant is one line plus the button', () => {
    const root = mount({ variant: 'strip' });
    expect(root.textContent).toContain('Agen memakai WebKit');
    expect(root.querySelector('button')?.textContent).toContain('Pakai Chromium');
    expect(root.textContent).not.toContain('Biaya pindah');
  });
});
