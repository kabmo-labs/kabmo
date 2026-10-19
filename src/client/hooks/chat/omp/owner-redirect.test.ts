/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The client half of the cross-process ownership guard.
 *
 * The property that matters: a `session_owned_elsewhere` response with an
 * `ownerPort` MOVES THE TAB to the owning instance, because both instances
 * share one database and one agent dir — the session is already open there, and
 * retrying locally is what makes omp fork it. Everything else keeps the plain
 * refusal.
 */

import { afterAll, beforeEach, describe, expect, test } from 'bun:test';

import { redirectToOwningInstance } from '@/client/hooks/chat/omp/owner-redirect';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let assigned: string[];

/**
 * The runner's own `window` descriptor, restored in `afterAll`.
 *
 * `defineProperty` defaults `writable: false`, so a stub left in place makes
 * every LATER file's `globalThis.window = win.window` throw "Attempted to
 * assign to readonly property" — the whole directory's DOM suites then fail
 * with an error that names none of them. The descriptor is captured and put
 * back rather than replaced by a plain assignment, because the original may
 * itself be an accessor.
 */
beforeEach(() => {
  assigned = [];
  // happy-dom's location.assign is not writable; stand in a stub for the test.
  // Installed through the shared helper so the runner's own globals are
  // restored afterwards rather than left replaced for every later suite.
  installDomGlobals({
    location: {
      href: 'http://127.0.0.1:3001/?folderId=2',
      assign: (url: string) => assigned.push(url),
    },
  });
});

afterAll(() => {
  restoreDomGlobals();
});

describe('redirectToOwningInstance', () => {
  test('moves the tab to the owning instance, keeping the session id', () => {
    const moved = redirectToOwningInstance(
      { code: 'session_owned_elsewhere', ownerPort: 3195, sessionId: 'sess-9' },
      'fallback',
    );
    expect(moved).toBe(true);
    expect(assigned).toEqual(['http://127.0.0.1:3195/?folderId=2&sessionId=sess-9']);
  });

  test('uses the caller session id when the body omits one', () => {
    redirectToOwningInstance({ code: 'session_owned_elsewhere', ownerPort: 3195 }, 'sess-fallback');
    expect(assigned[0]).toContain('sessionId=sess-fallback');
  });

  test('a different error code is not a redirect', () => {
    expect(redirectToOwningInstance({ code: 'session_busy', ownerPort: 3195 }, 's')).toBe(false);
    expect(assigned).toEqual([]);
  });

  test('an owner Kabmo cannot place is not a redirect', () => {
    expect(redirectToOwningInstance({ code: 'session_owned_elsewhere', ownerPort: null }, 's')).toBe(false);
    expect(assigned).toEqual([]);
  });
});
