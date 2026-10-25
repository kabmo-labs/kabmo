/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `isSpawnArrival` / `isOwnSpawn` — the two questions a session-id change asks.
 *
 * Both are pure so every ordering can be stated directly. The orderings are the
 * point: the browser is where they were found (three CI specs at once showed an
 * answer on screen and then an empty timeline), but reproducing a child that
 * answers before the URL flips is not something a browser spec can be asked to
 * do on demand.
 */

import { describe, expect, test } from 'bun:test';
import { isOwnSpawn, isSpawnArrival } from '@/client/hooks/chat/timeline/session-switch';

describe('isSpawnArrival', () => {
  test('the id the send path recorded is an arrival, whatever the previous id was', () => {
    // A chat opened from a WORKSPACE: no `?sessionId=` at all, so the previous
    // id is null and the URL moves straight to the child's UUID. This is the
    // shape that used to clear a finished turn.
    expect(
      isSpawnArrival({ sessionId: 'uuid-1', previousSessionId: null, adoptedSessionId: 'uuid-1' }),
    ).toBe(true);
    // A pending chat, mid-run or after it: same fact.
    expect(
      isSpawnArrival({ sessionId: 'uuid-1', previousSessionId: 'new-9', adoptedSessionId: 'uuid-1' }),
    ).toBe(true);
  });

  test('`new-…` → UUID is still an arrival when the record was already consumed', () => {
    // The pending store hands the adoption to the session-state provider once,
    // so the URL's own shape is the only evidence left.
    expect(
      isSpawnArrival({ sessionId: 'uuid-1', previousSessionId: 'new-9', adoptedSessionId: null }),
    ).toBe(true);
  });

  test('opening another session is not an arrival', () => {
    expect(
      isSpawnArrival({ sessionId: 'uuid-2', previousSessionId: 'uuid-1', adoptedSessionId: 'uuid-1' }),
    ).toBe(false);
  });

  test('a null or unchanged id is not an arrival', () => {
    expect(isSpawnArrival({ sessionId: null, previousSessionId: 'uuid-1', adoptedSessionId: null })).toBe(false);
    expect(
      isSpawnArrival({ sessionId: 'uuid-1', previousSessionId: 'uuid-1', adoptedSessionId: 'uuid-1' }),
    ).toBe(true);
  });
});

describe('isOwnSpawn', () => {
  test('a pending id and the adopted UUID are both own spawns', () => {
    expect(isOwnSpawn('new-9', null)).toBe(true);
    expect(isOwnSpawn('uuid-1', 'uuid-1')).toBe(true);
  });

  test('a session this page did not spawn is not one', () => {
    expect(isOwnSpawn('uuid-2', 'uuid-1')).toBe(false);
    expect(isOwnSpawn(null, 'uuid-1')).toBe(false);
  });
});
