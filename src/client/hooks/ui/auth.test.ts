/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The 401 → login-screen bridge.
 *
 * What it must NOT do is the point of this file. A 401 is the answer to a
 * question as often as it is a lost session — `POST /api/auth/password` answers
 * one to a mistyped current password — and reading it as a lost session put a
 * signed-in user's whole workspace behind the login screen over an ordinary
 * typo. So the store must stay where it is for anything under `/api/auth/`, flip
 * for a gated route, and ignore anything that is not this origin's `/api/`.
 *
 * Runs against a real DOM (happy-dom) because the bridge wraps `window.fetch`.
 * A static import is safe here, unlike the DOM-binding modules: nothing in
 * `auth.ts` touches a global at evaluation time, and the install happens inside
 * `beforeAll`, after the window exists.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';

import { currentAuthState, installAuthFetchBridge, primeAuthState } from '@/client/hooks/ui/auth';

const displaced: Record<string, unknown> = {};
const installed: Record<string, unknown> = {};

/** What the stubbed network answers. Replaced per test. */
let responder: (input: RequestInfo | URL) => Response = () => new Response('{}', { status: 200 });

beforeAll(() => {
  const win = new Window({ url: 'http://localhost/' });
  for (const [key, value] of Object.entries({ window: win })) {
    displaced[key] = (globalThis as Record<string, unknown>)[key];
    installed[key] = value;
    (globalThis as Record<string, unknown>)[key] = value;
  }
  // The bridge captures `window.fetch` when it installs, so this stub — not
  // happy-dom's own — is what every later request reaches. The double assertion
  // is happy-dom's response TYPE against the runtime's; the bridge reads only
  // `.status` and hands the object back untouched.
  win.fetch = (async (input: RequestInfo | URL) => responder(input)) as unknown as typeof win.fetch;

  installAuthFetchBridge();
});

// Every test file shares one process, so the global goes back the way it was.
afterAll(() => {
  for (const key of Object.keys(installed)) {
    if (displaced[key] === undefined) delete (globalThis as Record<string, unknown>)[key];
    else (globalThis as Record<string, unknown>)[key] = displaced[key];
  }
});

beforeEach(() => {
  responder = () => new Response('{}', { status: 200 });
  primeAuthState(true);
});

/** The gate's own answer: the session is gone. */
function unauthorized(): Response {
  return new Response(JSON.stringify({ error: 'UI authentication required' }), { status: 401 });
}

describe('the 401 bridge', () => {
  test('a wrong current password does not end the session', async () => {
    responder = unauthorized;

    const response = await window.fetch('/api/auth/password', { method: 'POST' });

    expect(response.status).toBe(401);
    expect(currentAuthState()).toBe('authenticated');
  });

  test('a 401 from a gated route does end it', async () => {
    responder = unauthorized;

    await window.fetch('/api/settings');

    expect(currentAuthState()).toBe('required');
  });

  test('another origin and a document path are not this session', async () => {
    responder = unauthorized;

    await window.fetch('http://elsewhere.test/api/settings');
    await window.fetch('/login');

    expect(currentAuthState()).toBe('authenticated');
  });

  test('an authenticated response leaves the store alone', async () => {
    await window.fetch('/api/settings');

    expect(currentAuthState()).toBe('authenticated');
  });
});
