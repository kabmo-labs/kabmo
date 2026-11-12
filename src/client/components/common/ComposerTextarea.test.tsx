/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * ArrowUp recall as the operator reaches it: through the composer's own
 * textarea, not the hook in isolation.
 *
 * The picker is off (`enablePicker={false}`) so the only owner of an arrow key
 * here is the recall, and the assertion is about the draft that lands in the
 * box — the wiring between `ComposerTextarea`'s key handler and the history
 * hook, which a hook-only test cannot see.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { useState } from 'preact/hooks';
import { ComposerTextarea } from '@/client/components/common/ComposerTextarea';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

const nativeFetch = globalThis.fetch;
const nativeFrame = globalThis.requestAnimationFrame;
const nativeKeyboardEvent = globalThis.KeyboardEvent;

let container: HTMLElement | undefined;
let draft: { value: string };
let requested: string[] = [];

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  installDomGlobals(win);
  (globalThis as unknown as Record<string, unknown>).KeyboardEvent = win.KeyboardEvent;
});

beforeEach(() => {
  requested = [];
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  }) as typeof globalThis.requestAnimationFrame;
  globalThis.fetch = ((input: string | URL | Request) => {
    requested.push(String(input));
    return Promise.resolve(new Response(JSON.stringify({ prompts: ['recalled prompt'] })));
  }) as unknown as typeof fetch;
  draft = { value: '' };
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
  container = undefined;
});

afterAll(() => {
  globalThis.fetch = nativeFetch;
  globalThis.requestAnimationFrame = nativeFrame;
  if (nativeKeyboardEvent === undefined) delete (globalThis as unknown as Record<string, unknown>).KeyboardEvent;
  else globalThis.KeyboardEvent = nativeKeyboardEvent;
  restoreDomGlobals();
});

function mount(): HTMLTextAreaElement {
  function Probe() {
    const [value, setValue] = useState('');
    draft.value = value;
    return h(ComposerTextarea, {
      value,
      onChange: setValue,
      onSend: () => {},
      sessionId: 'session-1',
      enablePicker: false,
    });
  }
  container = document.body.appendChild(document.createElement('div'));
  act(() => {
    render(h(Probe, null), container!);
  });
  const textarea = container.querySelector('textarea');
  if (!textarea) throw new Error('the composer rendered no textarea');
  return textarea as HTMLTextAreaElement;
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 4; turn++) await Promise.resolve();
}

describe('ComposerTextarea prompt recall', () => {
  test('ArrowUp replaces the draft with the newest prompt', async () => {
    const textarea = mount();
    act(() => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    });
    await settle();
    expect(requested).toEqual(['/api/chat/prompt-history?sessionId=session-1']);
    expect(draft.value).toBe('recalled prompt');
  });

  test('the recalled text leaves through the composer\'s own send', async () => {
    const textarea = mount();
    act(() => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    });
    await settle();
    expect(textarea.value).toBe('recalled prompt');
  });
});
