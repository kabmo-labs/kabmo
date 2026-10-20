/**
 * The login screen's header.
 *
 * It is the product's own lockup — the mark's green plate and the word — and
 * nothing else: the key glyph that used to sit above it was a second icon for a
 * screen whose only control is already labelled "Password". The assertions are
 * about the RENDERED tree, because the failure this guards is a screen that
 * still looks right in a class list while drawing two marks.
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

describe('LoginScreen header', () => {
  test('draws the wordmark as the header, with the mark in it', async () => {
    const el = await mount();
    const heading = el.querySelector('h1');
    expect(heading).toBeTruthy();
    // The mark's own geometry, not a font letter: the plate plus three strokes.
    const mark = heading?.querySelector('svg[viewBox="0 0 64 64"]');
    expect(mark).toBeTruthy();
    expect(mark?.querySelector('rect')).toBeTruthy();
    expect(mark?.querySelectorAll('path').length).toBe(3);
    // Hero size, so the lockup is the screen's identity rather than a caption.
    expect(heading?.querySelector('span')?.className).toContain('text-3xl');
  });

  test('carries no second icon', async () => {
    const el = await mount();
    // The header holds exactly one SVG — the mark. A key glyph above it would be
    // a second. The field's eye toggle is a CONTROL, not a mark, so it is
    // deliberately outside this count.
    const heading = el.querySelector('h1');
    expect(heading?.querySelectorAll('svg').length).toBe(1);
    expect(heading?.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 64 64');
  });

  test('still names the product for assistive tech and keeps the form', async () => {
    const el = await mount();
    expect(el.textContent).toContain('Kabmo');
    const password = el.querySelector('input[type="password"]');
    expect(password?.getAttribute('aria-label')).toBe('Password');
    expect(el.querySelector('button[type="submit"]')?.textContent).toContain('Sign in');
  });
});
