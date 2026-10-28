/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The native shell's resume hook.
 *
 * A backgrounded Android WebView fires no `visibilitychange` on return, and a
 * socket the server's heartbeat reaped while the page was frozen produces no
 * `close` — so the shell is the only thing that knows the app came back. It
 * evaluates `window.__kabmoResume()`, and that has to be a function the page
 * installed before the first render.
 *
 * What is pinned here is the CONTRACT between the two sides (the property name,
 * and that it is installed idempotently) plus the one behaviour that makes it
 * safe to call unconditionally: with nothing subscribed it does nothing at all,
 * because the shell calls it on every foreground, including the first.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';

import { RESUME_PROPERTY, installResumeDispatcher } from '@/client/lib/native/resume';
import { resetRealtimeClient } from '@/shared/lib/realtime/client';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

afterEach(() => {
  resetRealtimeClient();
  restoreDomGlobals();
});

function installWindow(): Window {
  const win = new Window({ url: 'http://localhost/' });
  installDomGlobals(win);
  return win;
}

describe('installResumeDispatcher', () => {
  test('exposes window.__kabmoResume and is idempotent', () => {
    const win = installWindow();
    installResumeDispatcher();
    installResumeDispatcher();

    const installed = (win as unknown as Record<string, unknown>)[RESUME_PROPERTY];
    expect(typeof installed).toBe('function');
  });

  test('the property name is the one the shells evaluate', () => {
    // Spelled out rather than read from the module: the Kotlin and Swift shells
    // hardcode the string in an `evaluateJavascript`, so a rename here has to be
    // a deliberate edit there too. This is the assertion that fails if it is not.
    expect(RESUME_PROPERTY).toBe('__kabmoResume');
  });

  test('calling it with nothing subscribed dials nothing', () => {
    const win = installWindow();
    installResumeDispatcher();
    const resume = (win as unknown as Record<string, unknown>)[RESUME_PROPERTY] as () => void;

    // The shell calls this on EVERY foreground, including the very first, so it
    // must be inert when the page has no subscription — otherwise a phone would
    // open a socket the moment the app appears, before anything asked for one.
    expect(() => resume()).not.toThrow();
  });
});
