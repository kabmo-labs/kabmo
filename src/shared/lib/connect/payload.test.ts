/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The pairing payload's parser, which is the input to a request that hands out a
 * credential.
 *
 * The cases worth pinning are the refusals: an expired code, a payload with no
 * candidate, a version this build does not understand, and a link whose scheme
 * is right but whose body is not. A parser that accepted any of them would let a
 * stale QR enrol a device.
 */

import { describe, expect, test } from 'bun:test';
import {
  encodePairingFragment,
  encodePairingPayload,
  normalizeOrigin,
  parsePairingFragment,
  parsePairingLink,
  parsePairingPayload,
  PAIRING_VERSION,
  type PairingPayload,
} from '@/shared/lib/connect/payload';

const NOW = Date.parse('2026-11-15T10:00:00Z');

function payload(overrides: Partial<PairingPayload> = {}): PairingPayload {
  return {
    v: PAIRING_VERSION,
    pairingId: 'pair-1',
    secret: 'secret-value',
    serverId: 'server-1',
    label: 'rajeb-macbook',
    expiresAt: new Date(NOW + 120_000).toISOString(),
    candidates: [
      { kind: 'tailscale', url: 'https://node.tailnet.ts.net' },
      { kind: 'lan', url: 'http://192.168.18.76:3000' },
    ],
    ...overrides,
  };
}

describe('encodePairingPayload / parsePairingPayload', () => {
  test('round-trips every field', () => {
    const parsed = parsePairingPayload(encodePairingPayload(payload()), NOW);
    expect(parsed).toEqual(payload());
  });

  test('refuses an expired payload', () => {
    const link = encodePairingPayload(payload({ expiresAt: new Date(NOW - 1).toISOString() }));
    expect(parsePairingPayload(link, NOW)).toBeNull();
  });

  test('refuses to mint a payload with no usable candidate', () => {
    // A code with no route would scan successfully and then fail every probe,
    // which reads as a broken camera rather than a missing tunnel.
    expect(() => encodePairingPayload(payload({ candidates: [] }))).toThrow('Invalid pairing payload');
  });

  test('refuses a link with the wrong scheme', () => {
    const link = encodePairingPayload(payload()).replace('kabmo://', 'https://');
    expect(parsePairingPayload(link, NOW)).toBeNull();
  });

  test('refuses a body that is not JSON', () => {
    expect(parsePairingPayload('kabmo://connect?v=1&p=bm90LWpzb24', NOW)).toBeNull();
  });

  test('refuses a version this build does not understand', () => {
    const link = encodePairingPayload(payload()).replace('v=1', 'v=2');
    expect(parsePairingPayload(link, NOW)).toBeNull();
  });

  test('drops a candidate whose URL is not an http origin', () => {
    const link = encodePairingPayload(
      payload({
        candidates: [
          { kind: 'lan', url: 'ftp://192.168.18.76' },
          { kind: 'tailscale', url: 'https://node.tailnet.ts.net' },
        ],
      }),
    );
    expect(parsePairingPayload(link, NOW)?.candidates).toEqual([
      { kind: 'tailscale', url: 'https://node.tailnet.ts.net' },
    ]);
  });
});

describe('normalizeOrigin', () => {
  test('strips a path, a query and a trailing slash', () => {
    expect(normalizeOrigin('https://node.ts.net/some/path?x=1')).toBe('https://node.ts.net');
  });

  test('keeps a non-default port', () => {
    expect(normalizeOrigin('http://192.168.18.76:3000/')).toBe('http://192.168.18.76:3000');
  });

  test('refuses a non-http scheme', () => {
    expect(normalizeOrigin('ws://node.ts.net')).toBeNull();
  });
});

describe('parsePairingLink', () => {
  test('reads the browser form the QR actually encodes', () => {
    const fragment = encodePairingFragment(payload());
    const parsed = parsePairingLink(`https://node.tailnet.ts.net/pair#${fragment}`, NOW);
    expect(parsed?.pairingId).toBe('pair-1');
    expect(parsed?.candidates).toHaveLength(2);
  });

  test('reads the deep link a native shell registers', () => {
    const parsed = parsePairingLink(encodePairingPayload(payload()), NOW);
    expect(parsed?.pairingId).toBe('pair-1');
  });

  test('refuses a link with no fragment', () => {
    expect(parsePairingLink('https://node.tailnet.ts.net/pair', NOW)).toBeNull();
  });

  test('refuses a fragment that is not a payload', () => {
    expect(parsePairingLink('https://node.tailnet.ts.net/pair#not-base64', NOW)).toBeNull();
  });

  test('refuses an expired code carried in a fragment', () => {
    const fragment = encodePairingFragment(payload({ expiresAt: new Date(NOW - 1).toISOString() }));
    expect(parsePairingLink(`https://node.tailnet.ts.net/pair#${fragment}`, NOW)).toBeNull();
  });
});

describe('parsePairingFragment', () => {
  test('accepts the fragment with or without its leading hash', () => {
    const fragment = encodePairingFragment(payload());
    expect(parsePairingFragment(fragment, NOW)?.pairingId).toBe('pair-1');
    expect(parsePairingFragment(`#${fragment}`, NOW)?.pairingId).toBe('pair-1');
  });
});
