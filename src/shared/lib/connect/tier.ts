/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which route a client should use, and why the order is not "fastest wins".
 *
 * The naive rule — pick the lowest round-trip time — is wrong here, and the
 * measurement is what makes it wrong. On a LAN, `http://192.168.x.x` is not a
 * secure context: `crypto.subtle`, `getUserMedia`, `navigator.clipboard.readText`
 * and `serviceWorker` are all absent (measured in Chromium, Pixel 7 profile).
 * Dictation stops working, copy/paste degrades, and the password crosses the
 * Wi-Fi in cleartext. Tailscale on the SAME network is a direct WireGuard peer
 * connection, so its round trip is the LAN's plus a fraction of a millisecond —
 * it costs nothing and it restores all four capabilities.
 *
 * So the order is a TIER, not a score: a lower tier always wins while it is
 * reachable, and the round trip only breaks ties inside a tier (an IPv4 address
 * and a MagicDNS name for the same node).
 *
 * **This module has no TypeScript caller, and that is deliberate.** A page
 * cannot probe another origin — `https` to `http` is mixed content, and
 * `/api/health` carries no CORS headers — so the probe and the switch can only
 * run in a native shell. What lives here is the contract those shells port, with
 * the hysteresis numbers pinned by tests, so the Kotlin and Swift versions have
 * one definition to match instead of three guesses.
 */

import type { ConnectCandidate, ConnectRouteKind } from '@/shared/lib/connect/types';

/**
 * Preference order. Lower is better.
 *
 * `lan` sits below `tailscale` deliberately: it is the fallback for a device
 * that has no tailnet, not the preferred route at home.
 */
export const ROUTE_TIER: Record<ConnectRouteKind, number> = {
  tailscale: 0,
  lan: 1,
  cloudflare: 2,
};

/** A candidate with the measurement the client took of it. */
export interface ProbedCandidate extends ConnectCandidate {
  /** Round trip to `/api/health`, in milliseconds. Null when unreachable. */
  rttMs: number | null;
}

/**
 * The best reachable candidate, or null when none answered.
 *
 * Ties inside a tier are broken by the round trip, and a candidate with no
 * measurement is treated as unreachable rather than as infinitely fast — a
 * probe that never ran must not win.
 */
export function pickRoute(candidates: readonly ProbedCandidate[]): ProbedCandidate | null {
  let best: ProbedCandidate | null = null;
  for (const candidate of candidates) {
    if (candidate.rttMs === null) continue;
    if (!best) {
      best = candidate;
      continue;
    }
    const tier = ROUTE_TIER[candidate.kind];
    const bestTier = ROUTE_TIER[best.kind];
    if (tier < bestTier) {
      best = candidate;
      continue;
    }
    if (tier === bestTier && candidate.rttMs < (best.rttMs ?? Number.POSITIVE_INFINITY)) {
      best = candidate;
    }
  }
  return best;
}

/**
 * Whether a newly measured winner is worth switching to.
 *
 * Without hysteresis two routes with near-equal round trips take turns being
 * "best", and every switch is a webview navigation — a visible reload. The
 * margin is deliberately asymmetric: a lower TIER always wins (that is a
 * capability change, not a speed one), while a same-tier win needs to be
 * meaningfully faster.
 */
export function shouldSwitch(
  active: ProbedCandidate | null,
  candidate: ProbedCandidate | null,
  options: { minGainMs?: number; minGainRatio?: number } = {},
): boolean {
  if (!candidate) return false;
  if (!active) return true;
  if (active.rttMs === null) return true;

  const activeTier = ROUTE_TIER[active.kind];
  const candidateTier = ROUTE_TIER[candidate.kind];
  if (candidateTier < activeTier) return true;
  if (candidateTier > activeTier) return false;

  const minGainMs = options.minGainMs ?? 30;
  const minGainRatio = options.minGainRatio ?? 0.2;
  const gain = active.rttMs - (candidate.rttMs ?? Number.POSITIVE_INFINITY);
  return gain > minGainMs && gain / active.rttMs > minGainRatio;
}
