/**
 * The password field's visibility toggle.
 *
 * The eye is a `type` switch on the SAME input, so what it must not do is move
 * the value: a reveal that rebuilt the field would clear the credential the
 * user just typed. The assertions are about the rendered tree and the input's
 * own `type`/`value`, because a class list proves nothing about either.
 *
 * The header's own assertions live in `index.test.tsx`; this file covers the
 * control beside the field and nothing else.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { LoginScreen } from '@/client/components/auth/login-screen';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'KeyboardEvent'] as const;
/** The runner's own globals, restored on teardown — deleting them would strip natives later files need. */
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};
const nativeFetch = globalThis.fetch;

let container: HTMLElement;

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in nativeGlobals)) nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
  // The screen re-checks the session on mount; an unanswerable probe leaves the
  // form alone, which is the state under test.
  target.fetch = async () => {
    throw new Error('offline');
  };
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (nativeGlobals[key] === undefined) delete target[key];
    else target[key] = nativeGlobals[key];
  }
  target.fetch = nativeFetch;
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
});

async function mount(): Promise<HTMLElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(h(LoginScreen, {}), container);
  });
  return container;
}

/** The one field the form submits — matched by its label, never by `type`, which is what changes. */
function passwordField(el: HTMLElement): HTMLInputElement | null {
  return el.querySelector<HTMLInputElement>('input[aria-label="Password"]');
}

describe('LoginScreen password visibility', () => {
  test('starts masked, with a labelled toggle beside the field', async () => {
    const el = await mount();
    expect(passwordField(el)?.type).toBe('password');
    const toggle = el.querySelector<HTMLButtonElement>('button[aria-label="Show password"]');
    expect(toggle).toBeTruthy();
    // A real button, not an svg with a click handler: keyboard reachable.
    expect(toggle?.getAttribute('type')).toBe('button');
    expect(toggle?.getAttribute('title')).toBe('Show password');
    expect(toggle?.getAttribute('aria-pressed')).toBe('false');
  });

  test('reveals the same field and puts it back, keeping the value', async () => {
    const el = await mount();
    await act(async () => {
      const input = passwordField(el);
      if (input) {
        input.value = 's3cret';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    expect(passwordField(el)?.value).toBe('s3cret');

    await act(async () => el.querySelector<HTMLButtonElement>('button[aria-label="Show password"]')?.click());
    expect(passwordField(el)?.type).toBe('text');
    expect(passwordField(el)?.value).toBe('s3cret');
    const hide = el.querySelector<HTMLButtonElement>('button[aria-label="Hide password"]');
    expect(hide?.getAttribute('aria-pressed')).toBe('true');
    expect(hide?.getAttribute('title')).toBe('Hide password');

    await act(async () => hide?.click());
    expect(passwordField(el)?.type).toBe('password');
    expect(passwordField(el)?.value).toBe('s3cret');
  });

  test('the toggle is disabled while a sign-in is in flight', async () => {
    const el = await mount();
    await act(async () => {
      const input = passwordField(el);
      if (input) {
        input.value = 's3cret';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    // The submit handler awaits `login`, so the in-flight state is observable
    // in the same tick the form is submitted.
    await act(async () => {
      el.querySelector<HTMLFormElement>('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(el.querySelector<HTMLButtonElement>('button[aria-label="Show password"]')?.disabled).toBe(true);
    expect(passwordField(el)?.disabled).toBe(true);
  });
});
