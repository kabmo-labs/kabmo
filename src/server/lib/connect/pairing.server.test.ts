/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One-time pairing secrets.
 *
 * The property that matters is single use: a code that can be redeemed twice
 * enrols a second device from a QR someone photographed. The second property is
 * that a wrong secret does NOT consume the code — otherwise a mistyped paste
 * would invalidate the code on screen.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { consumePairing, createPairing, resetPairings } from '@/server/lib/connect/pairing.server';

const CANDIDATES = [{ kind: 'lan' as const, url: 'http://192.168.18.76:3000' }];

afterEach(() => {
  resetPairings();
});

describe('pairing secrets', () => {
  test('redeems once and refuses the second attempt', () => {
    const { pairingId, secret } = createPairing(CANDIDATES);
    expect(consumePairing(pairingId, secret).ok).toBe(true);

    const second = consumePairing(pairingId, secret);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toContain('already used');
  });

  test('a wrong secret does not consume the code', () => {
    const { pairingId, secret } = createPairing(CANDIDATES);
    expect(consumePairing(pairingId, 'not-the-secret').ok).toBe(false);
    expect(consumePairing(pairingId, secret).ok).toBe(true);
  });

  test('an unknown pairing id is refused', () => {
    expect(consumePairing('nope', 'anything').ok).toBe(false);
  });

  test('carries the candidates the code was minted with', () => {
    const { pairingId, secret } = createPairing(CANDIDATES);
    const consumed = consumePairing(pairingId, secret);
    expect(consumed.ok && consumed.candidates).toEqual(CANDIDATES);
  });

  test('mints a distinct secret per code', () => {
    const first = createPairing(CANDIDATES);
    const second = createPairing(CANDIDATES);
    expect(first.secret).not.toBe(second.secret);
    expect(first.pairingId).not.toBe(second.pairingId);
  });
});
