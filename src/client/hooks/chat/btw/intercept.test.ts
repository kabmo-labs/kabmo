/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `/btw` interception.
 *
 * The token must be recognized the way omp parses a slash invocation — on the
 * earliest whitespace OR `:` — because a form Kabmo does not intercept is
 * sent to the model as literal text (omp's `/btw` is TUI-only, so nothing
 * downstream understands it).
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { dispatchBtwCommand } from '@/client/hooks/chat/btw/intercept';

/**
 * `bun test` runs without a DOM; the interceptor only needs an event target.
 *
 * The stub is installed for this file alone and REMOVED afterwards: several
 * other files in this suite install their own DOM by assigning `globalThis`,
 * and a `window` left behind here replaced theirs (measured: `use-file-editor`
 * failed with `form.get is not a function`).
 *
 * `window`, `Event` and `CustomEvent` all come from ONE happy-dom `Window`,
 * never from the ambient globals. `intercept.ts` builds its event with the
 * global `CustomEvent` and dispatches it on the global `window`, so a mixed
 * pair — a happy-dom class left installed by an earlier file, or the runner's
 * own classes captured at import time, which is itself order-dependent because
 * a file is imported right before it runs — is a cross-realm dispatch the
 * target rejects ("must be an instance of Event", ERR_INVALID_ARG_TYPE).
 */
const hadWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const hadEvent = Object.getOwnPropertyDescriptor(globalThis, 'Event');
const hadCustomEvent = Object.getOwnPropertyDescriptor(globalThis, 'CustomEvent');

function restoreGlobal(key: 'window' | 'Event' | 'CustomEvent', had: PropertyDescriptor | undefined): void {
  if (had) Object.defineProperty(globalThis, key, had);
  else delete (globalThis as Record<string, unknown>)[key];
}

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  Object.defineProperty(globalThis, 'window', { value: win, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'Event', { value: win.Event, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'CustomEvent', { value: win.CustomEvent, configurable: true, writable: true });
});

afterAll(() => {
  restoreGlobal('window', hadWindow);
  restoreGlobal('Event', hadEvent);
  restoreGlobal('CustomEvent', hadCustomEvent);
});

function capture(text: string): { handled: boolean; detail: unknown } {
  let detail: unknown;
  const listener = (event: Event) => {
    detail = (event as CustomEvent).detail;
  };
  window.addEventListener('omp:btw', listener);
  try {
    const handled = dispatchBtwCommand(text, []);
    return { handled, detail };
  } finally {
    window.removeEventListener('omp:btw', listener);
  }
}

describe('dispatchBtwCommand', () => {
  test('a bare command opens the panel with no question', () => {
    const { handled, detail } = capture('/btw');
    expect(handled).toBe(true);
    expect(detail).toEqual({ question: '' });
  });

  test('a whitespace-separated question is carried', () => {
    const { handled, detail } = capture('/btw what is this?');
    expect(handled).toBe(true);
    expect(detail).toEqual({ question: 'what is this?' });
  });

  test('a colon-separated question is the same invocation', () => {
    const { handled, detail } = capture('/btw:what is this?');
    expect(handled).toBe(true);
    expect(detail).toEqual({ question: 'what is this?' });
  });

  test('case does not matter', () => {
    expect(capture('/BTW hi').handled).toBe(true);
  });

  test('anything else is left for the normal send path', () => {
    expect(capture('hello /btw').handled).toBe(false);
    expect(capture('/btwx').handled).toBe(false);
    expect(capture('').handled).toBe(false);
  });
});
