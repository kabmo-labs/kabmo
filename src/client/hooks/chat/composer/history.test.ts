/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * ArrowUp recall in the composer: the cursor, the scope, the draft restore, and
 * the keys it must leave to the caret.
 *
 * The hook is mounted against a REAL textarea, because half of its contract is
 * about where the caret sits (a multi-line draft keeps its arrows) and the
 * other half about what lands in the box.
 *
 * No wall clock: the fetch is a stub this file answers, and
 * `requestAnimationFrame` is installed synchronously, so "settled" is a
 * microtask, never a duration.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { useState } from 'preact/hooks';
import { useComposerHistory, type ComposerHistory } from '@/client/hooks/chat/composer/history';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

const nativeFetch = globalThis.fetch;
const nativeFrame = globalThis.requestAnimationFrame;
const nativeKeyboardEvent = globalThis.KeyboardEvent;

let container: HTMLElement | undefined;
let holder: {
  api: ComposerHistory | null;
  value: string;
  setValue: (value: string) => void;
  sessionId: string | null;
  rerender: () => void;
};
let textareaRef: { current: HTMLTextAreaElement | null };
let requested: string[] = [];
let prompts: string[] = [];

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  installDomGlobals(win);
  // `DOM_TEST_GLOBALS` does not carry `KeyboardEvent`; this suite builds real
  // key events, so it installs the window's own class and puts it back.
  (globalThis as unknown as Record<string, unknown>).KeyboardEvent = win.KeyboardEvent;
});

beforeEach(() => {
  requested = [];
  prompts = ['newest prompt', 'older prompt'];
  // Synchronous frames: the hook only uses one to place the caret after the
  // value has landed, which is the render this file already drives.
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  }) as typeof globalThis.requestAnimationFrame;
  globalThis.fetch = ((input: string | URL | Request) => {
    requested.push(String(input));
    return Promise.resolve(new Response(JSON.stringify({ prompts })));
  }) as unknown as typeof fetch;
  textareaRef = { current: null };
  holder = {
    api: null,
    value: '',
    setValue: () => {},
    sessionId: 'session-1',
    rerender: () => {},
  };
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
  container = undefined;
});

afterAll(() => {
  globalThis.fetch = nativeFetch;
  globalThis.requestAnimationFrame = nativeFrame;
  if (nativeKeyboardEvent === undefined) {
    delete (globalThis as unknown as Record<string, unknown>).KeyboardEvent;
  } else {
    globalThis.KeyboardEvent = nativeKeyboardEvent;
  }
  restoreDomGlobals();
});

function mount(sessionId: string | null): void {
  holder.sessionId = sessionId;
  function Probe() {
    const [value, setValue] = useState('');
    const [, bump] = useState(0);
    holder.value = value;
    holder.setValue = setValue;
    holder.rerender = () => bump((turn) => turn + 1);
    holder.api = useComposerHistory({
      value,
      onChange: (next) => {
        setValue(next);
        if (textareaRef.current) textareaRef.current.value = next;
      },
      sessionId: holder.sessionId,
      textareaRef,
    });
    return h('textarea', {
      ref: (node: HTMLTextAreaElement | null) => {
        textareaRef.current = node;
      },
    });
  }
  container = document.body.appendChild(document.createElement('div'));
  act(() => {
    render(h(Probe, null), container!);
  });
}

/** Let the hook's fetch → then chain run out. Microtasks only, no duration. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 4; turn++) await Promise.resolve();
}

/** Type a draft and put the caret where the next arrow will read it. */
function writeDraft(value: string, caret = value.length): void {
  act(() => holder.setValue(value));
  if (!textareaRef.current) return;
  textareaRef.current.value = value;
  textareaRef.current.setSelectionRange(caret, caret);
}

function press(key: string, init: KeyboardEventInit = {}): boolean {
  const event = new KeyboardEvent('keydown', { key, cancelable: true, ...init });
  let consumed = false;
  act(() => {
    consumed = holder.api!.handleKey(event as never);
  });
  return consumed;
}

describe('useComposerHistory', () => {
  test('ArrowUp recalls the newest prompt, then the older one', async () => {
    mount('session-1');
    expect(press('ArrowUp')).toBe(true);
    await settle();
    expect(holder.value).toBe('newest prompt');
    expect(press('ArrowUp')).toBe(true);
    expect(holder.value).toBe('older prompt');
    // The list is exhausted: the key is still ours, and nothing changes.
    expect(press('ArrowUp')).toBe(true);
    expect(holder.value).toBe('older prompt');
  });

  test('ArrowDown walks back to the draft the list was entered from', async () => {
    mount('session-1');
    writeDraft('work in progress');

    press('ArrowUp');
    await settle();
    expect(holder.value).toBe('newest prompt');
    press('ArrowUp');
    expect(holder.value).toBe('older prompt');
    press('ArrowDown');
    expect(holder.value).toBe('newest prompt');
    press('ArrowDown');
    expect(holder.value).toBe('work in progress');
  });

  test('ArrowDown from the draft is left to the caret', () => {
    mount('session-1');
    expect(press('ArrowDown')).toBe(false);
    expect(requested).toHaveLength(0);
  });

  test('a pending new chat asks for the merged list', async () => {
    mount('new-1790756769131');
    press('ArrowUp');
    await settle();
    expect(requested).toEqual(['/api/chat/prompt-history']);
  });

  test('an open chat scopes the list to its own id', async () => {
    mount('01a1b49f-0000-7000-8000-000000000001');
    press('ArrowUp');
    await settle();
    expect(requested).toEqual(['/api/chat/prompt-history?sessionId=01a1b49f-0000-7000-8000-000000000001']);
  });

  test('a modified arrow is never consumed', () => {
    mount('session-1');
    expect(press('ArrowUp', { shiftKey: true })).toBe(false);
    expect(press('ArrowUp', { metaKey: true })).toBe(false);
    expect(press('ArrowUp', { ctrlKey: true })).toBe(false);
    expect(press('ArrowUp', { altKey: true })).toBe(false);
  });

  test('ArrowUp below the first line moves the caret instead', () => {
    mount('session-1');
    writeDraft('first line\nsecond line');
    expect(press('ArrowUp')).toBe(false);
    expect(requested).toHaveLength(0);
  });

  test('ArrowUp on the first line of a multi-line draft recalls', async () => {
    mount('session-1');
    writeDraft('first line\nsecond line', 3);
    expect(press('ArrowUp')).toBe(true);
    await settle();
    expect(holder.value).toBe('newest prompt');
  });

  test('ArrowDown above the last line moves the caret instead', async () => {
    mount('session-1');
    press('ArrowUp');
    await settle();
    writeDraft('line one\nline two', 2);
    expect(press('ArrowDown')).toBe(false);
    expect(holder.value).toBe('line one\nline two');
  });

  test('a failed fetch recalls nothing and the next ArrowUp asks again', async () => {
    globalThis.fetch = ((input: string | URL | Request) => {
      requested.push(String(input));
      return Promise.resolve(new Response('{}', { status: 500 }));
    }) as unknown as typeof fetch;
    mount('session-1');
    expect(press('ArrowUp')).toBe(true);
    await settle();
    expect(holder.value).toBe('');
    expect(press('ArrowUp')).toBe(true);
    await settle();
    expect(requested).toHaveLength(2);
  });

  test('a session switch forgets the list', async () => {
    mount('session-1');
    press('ArrowUp');
    await settle();
    expect(holder.value).toBe('newest prompt');

    prompts = ['other chat prompt'];
    act(() => {
      holder.sessionId = 'session-2';
      holder.rerender();
    });
    expect(press('ArrowUp')).toBe(true);
    await settle();
    expect(holder.value).toBe('other chat prompt');
    expect(requested.at(-1)).toBe('/api/chat/prompt-history?sessionId=session-2');
  });

  test('an emptied draft starts the next recall at the newest entry', async () => {
    mount('session-1');
    press('ArrowUp');
    await settle();
    press('ArrowUp');
    expect(holder.value).toBe('older prompt');

    // Sending clears the composer; the next recall is a fresh walk.
    writeDraft('');
    prompts = ['just sent', 'newest prompt', 'older prompt'];
    press('ArrowUp');
    await settle();
    expect(holder.value).toBe('just sent');
  });
});
