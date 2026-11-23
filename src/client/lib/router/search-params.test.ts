/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `useSearchParams` reads the window IN SCOPE, and a window that carries no
 * `location` is a shape the app has to survive.
 *
 * The store is module-level, so a component mounted by one suite can be
 * re-rendered after that suite restored the globals — and `installDomGlobals({})`
 * builds a window without a `location` on purpose (the SSR case). Reading
 * `window.location.search` there threw a `TypeError` that named none of the
 * files involved: measured on the Windows gate, where it killed every case in
 * `list-slots.test.ts` and one in `plugin-contributions.test.ts`, whose stacks
 * named neither file. The answer for a window that cannot describe a URL is
 * "no query string", not an exception.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { useSearchParams } from '@/client/lib/router/search-params';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let container: HTMLElement;
let seen: string | null = null;

function Probe() {
  const [params] = useSearchParams();
  seen = params.toString();
  return null;
}

beforeEach(() => {
  // A base DOM, so the container exists before a case replaces the window: a
  // case that installs a location-less window still renders into real nodes.
  installDomGlobals(new Window({ url: 'http://localhost' }));
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
  seen = null;
  restoreDomGlobals();
});

afterAll(() => restoreDomGlobals());

function mount(): void {
  act(() => {
    render(h(Probe, null), container);
  });
}

describe('useSearchParams', () => {
  test('reads the window it is mounted under, not the one that existed at import', () => {
    installDomGlobals(new Window({ url: 'http://localhost/?sessionId=first' }));
    mount();
    expect(seen).toBe('sessionId=first');

    installDomGlobals(new Window({ url: 'http://localhost/?sessionId=second' }));
    mount();
    expect(seen).toBe('sessionId=second');
  });

  test('a window with no location reads as no query string instead of throwing', () => {
    // Exactly the shape `installDomGlobals({})` installs: `window` exists, the
    // DOM does not. It used to throw out of the component's render.
    installDomGlobals({});
    expect(() => mount()).not.toThrow();
    expect(seen).toBe('');
  });

  test('a window whose location has no search is the same answer', () => {
    installDomGlobals({ location: {} });
    expect(() => mount()).not.toThrow();
    expect(seen).toBe('');
  });
});
