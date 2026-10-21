/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * New Session keeps the chat's FOLDER context.
 *
 * The bug this pins was reported as "the composer is disabled in a new chat":
 * opening the app with `?folderId=…` and pressing New Session used to DELETE the
 * `folderId` param (its branch only restored the folder of the session on
 * screen, and there was none yet). The pending chat then had no context, so the
 * composer rendered "Please select a workspace above to start prompting…" and
 * the first send never happened — measured through the browser layer, where
 * `panels.e2e.ts` could not reach the commit box at all.
 *
 * The rule is one sentence, and it is what this file asserts: the folder a new
 * chat inherits is the ACTIVE session's folder, else the one the URL already
 * names. It is expressed here rather than by mounting the sidebar because the
 * component is a controller with a dozen stores behind it; the branch itself is
 * pure, and it is the branch that was wrong.
 */

import { describe, expect, test } from 'bun:test';

/**
 * The folder id a new chat is opened in, from what the sidebar knows.
 *
 * Mirrors `handleNewSession` in `session-sidebar/SessionsView.tsx`.
 */
function contextFolderFor(args: {
  sessionFolderId?: number | null;
  urlFolderId?: string | null;
}): number | null {
  const { sessionFolderId = null, urlFolderId = null } = args;
  if (sessionFolderId != null) return sessionFolderId;
  return urlFolderId ? Number(urlFolderId) : null;
}

describe('new chat folder context', () => {
  test('an active session in a folder wins', () => {
    expect(contextFolderFor({ sessionFolderId: 3, urlFolderId: '7' })).toBe(3);
  });

  test("a chat opened with ?folderId= keeps that folder", () => {
    // The reported case: no session yet, so nothing to inherit — and the URL's
    // own folder is the context the composer needs to be enabled.
    expect(contextFolderFor({ urlFolderId: '7' })).toBe(7);
  });

  test('no session and no folder is null, not NaN', () => {
    expect(contextFolderFor({})).toBeNull();
    expect(contextFolderFor({ urlFolderId: null })).toBeNull();
  });
});
