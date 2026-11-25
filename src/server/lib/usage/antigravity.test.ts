import { describe, expect, test } from 'bun:test';
import { usableAccessToken } from '@/server/lib/usage/antigravity';

/**
 * The reader does not refresh: an expired token must become "open Antigravity
 * once" instead of a request Google refuses, and a live one must still be used.
 */
describe('usableAccessToken', () => {
  test('uses a token whose stored lifetime has not run out', () => {
    expect(usableAccessToken({ accessToken: 'live', expiresAt: Date.now() + 60_000 })).toBe('live');
  });

  test('refuses an expired token rather than send it to Google', () => {
    expect(usableAccessToken({ accessToken: 'stale', expiresAt: Date.now() - 1 })).toBeNull();
  });

  test('uses a token whose store states no expiry', () => {
    expect(usableAccessToken({ accessToken: 'no-expiry' })).toBe('no-expiry');
  });
});
