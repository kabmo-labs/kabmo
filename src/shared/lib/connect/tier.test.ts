/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The route order, pinned.
 *
 * The case that matters is the one a "fastest wins" rule gets wrong: a LAN
 * address that answers in 2 ms must still lose to Tailscale at 4 ms, because the
 * LAN origin is not a secure context and dictation, clipboard read and the
 * service worker are all absent there. A test that only compared round trips
 * would pass while the product regressed.
 */

import { describe, expect, test } from 'bun:test';
import { pickRoute, shouldSwitch, type ProbedCandidate } from '@/shared/lib/connect/tier';

function candidate(kind: ProbedCandidate['kind'], rttMs: number | null): ProbedCandidate {
  return { kind, url: `https://${kind}.example`, rttMs };
}

describe('pickRoute', () => {
  test('prefers Tailscale over a faster LAN address', () => {
    const winner = pickRoute([candidate('lan', 2), candidate('tailscale', 4)]);
    expect(winner?.kind).toBe('tailscale');
  });

  test('falls back to LAN when Tailscale did not answer', () => {
    const winner = pickRoute([candidate('lan', 2), candidate('tailscale', null)]);
    expect(winner?.kind).toBe('lan');
  });

  test('uses Cloudflare only when nothing better answered', () => {
    const winner = pickRoute([candidate('lan', null), candidate('cloudflare', 40)]);
    expect(winner?.kind).toBe('cloudflare');
  });

  test('breaks a tie inside one tier by round trip', () => {
    const winner = pickRoute([
      { kind: 'tailscale', url: 'https://ipv4.example', rttMs: 9 },
      { kind: 'tailscale', url: 'https://magicdns.example', rttMs: 3 },
    ]);
    expect(winner?.url).toBe('https://magicdns.example');
  });

  test('answers null when nothing answered', () => {
    expect(pickRoute([candidate('lan', null), candidate('tailscale', null)])).toBeNull();
  });
});

describe('shouldSwitch', () => {
  test('switches to a better tier even when it is slower', () => {
    expect(shouldSwitch(candidate('lan', 2), candidate('tailscale', 30))).toBe(true);
  });

  test('never switches down a tier', () => {
    expect(shouldSwitch(candidate('tailscale', 30), candidate('lan', 1))).toBe(false);
  });

  test('ignores a same-tier win that is too small to feel', () => {
    // 40 ms -> 30 ms is a 25% gain but only 10 ms: a reload costs more than that.
    expect(shouldSwitch(candidate('tailscale', 40), candidate('tailscale', 30))).toBe(false);
  });

  test('takes a same-tier win that is both large and proportional', () => {
    expect(shouldSwitch(candidate('tailscale', 200), candidate('tailscale', 60))).toBe(true);
  });

  test('switches when the active route stopped answering', () => {
    expect(shouldSwitch(candidate('tailscale', null), candidate('lan', 5))).toBe(true);
  });
});
