/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One-time pairing secrets.
 *
 * A secret is minted when the QR is drawn, lives for two minutes, and is
 * consumed by the first successful claim. It is held in memory rather than in
 * the database on purpose: a pairing that outlives the process that offered it
 * is a pairing nobody is looking at, and a restart should invalidate the code on
 * screen rather than leave a window open.
 *
 * The secret is compared by hash, so a heap dump or a log line that captured the
 * stored value cannot be replayed as a credential.
 */

import type { ConnectCandidate } from '@/shared/lib/connect/types';

/**
 * How long a code stays valid.
 *
 * Five minutes, not two. A camera scan takes seconds, but the image path does
 * not: screenshot the dialog, send it to the other device, open the login screen,
 * pick the file. Measured on this machine, that round trip took 6–16 seconds when
 * scripted and minutes when a human does it — and a code that expires mid-transfer
 * reads as "this QR is not a Kabmo code", which is the wrong diagnosis.
 *
 * The window is still short enough that a photographed code is worthless by the
 * time anyone could act on it, and it is single-use regardless.
 */
export const PAIRING_TTL_MS = 5 * 60 * 1000;

export interface PendingPairing {
  pairingId: string;
  secretHash: string;
  candidates: ConnectCandidate[];
  expiresAt: number;
  /**
   * The code as a downloadable PNG, drawn once when the code is minted.
   *
   * Held here because the download is an HTTP request from a shell's own
   * download machinery (or the browser), which can only carry the session
   * cookie — it cannot run the page's renderer. The secret is not stored in a
   * form that can be replayed as a credential, and the bytes carry the same
   * five-minute life as everything else in this entry.
   */
  qrPng: Uint8Array | null;
}

declare global {
  // eslint-disable-next-line no-var
  var __kabmoPairings: Map<string, PendingPairing> | undefined;
}

function store(): Map<string, PendingPairing> {
  globalThis.__kabmoPairings ??= new Map();
  return globalThis.__kabmoPairings;
}

function hashSecret(secret: string): string {
  return new Bun.CryptoHasher('sha256').update(secret).digest('hex');
}

/** Drop expired entries. Called on every mint and claim, so the map stays small. */
function sweep(now: number): void {
  for (const [id, entry] of store()) {
    if (entry.expiresAt <= now) store().delete(id);
  }
}

/** Mint a pairing and return the plaintext secret exactly once. */
export function createPairing(candidates: ConnectCandidate[]): {
  pairingId: string;
  secret: string;
  expiresAt: string;
} {
  const now = Date.now();
  sweep(now);
  const pairingId = crypto.randomUUID();
  const secret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
  const expiresAt = now + PAIRING_TTL_MS;
  store().set(pairingId, {
    pairingId,
    secretHash: hashSecret(secret),
    candidates,
    expiresAt,
    qrPng: null,
  });
  return { pairingId, secret, expiresAt: new Date(expiresAt).toISOString() };
}

/**
 * Attach the rendered PNG to a pending code.
 *
 * Separate from `createPairing` because the image encodes the browser link,
 * which needs the secret that minting has just produced — the route is the only
 * place that has both.
 */
export function attachPairingQr(pairingId: string, png: Uint8Array): void {
  const entry = store().get(pairingId);
  if (!entry) return;
  entry.qrPng = png;
}

/** The code's PNG, or null when it was never drawn, expired, or was used. */
export function pairingQr(pairingId: string): Uint8Array | null {
  const now = Date.now();
  sweep(now);
  const entry = store().get(pairingId);
  if (!entry || entry.expiresAt <= now) return null;
  return entry.qrPng;
}

/**
 * Consume a pairing, or answer why it cannot be consumed.
 *
 * Single use is enforced by DELETING the entry before the caller does anything
 * with it: a claim that fails afterwards (a database error) costs the user a new
 * QR, which is the safe direction. The alternative — delete after success —
 * leaves a window where two devices redeem the same code.
 */
export function consumePairing(
  pairingId: string,
  secret: string,
): { ok: true; candidates: ConnectCandidate[] } | { ok: false; reason: string } {
  const now = Date.now();
  sweep(now);
  const entry = store().get(pairingId);
  if (!entry) return { ok: false, reason: 'This pairing code has expired or was already used.' };
  if (entry.expiresAt <= now) {
    store().delete(pairingId);
    return { ok: false, reason: 'This pairing code has expired.' };
  }
  if (entry.secretHash !== hashSecret(secret)) {
    return { ok: false, reason: 'This pairing code does not match the one this server issued.' };
  }
  store().delete(pairingId);
  return { ok: true, candidates: entry.candidates };
}

/** Drop every pending pairing. The tests use it; a running server has no reason to. */
export function resetPairings(): void {
  globalThis.__kabmoPairings = undefined;
}
