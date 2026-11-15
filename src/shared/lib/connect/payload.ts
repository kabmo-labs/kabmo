/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The pairing payload a QR code carries, and the parser that refuses a bad one.
 *
 * The payload is a deep link rather than a bare JSON blob so a desktop shell can
 * accept it as a pasted link, and so the OS can route it to the app. The secret
 * lives inside the encoded body, never in a query parameter of its own: a
 * fragment or an opaque `p=` is not logged by proxies the way a named parameter
 * is, and the whole point of the secret is that it is single-use and short-lived.
 *
 * Versioned from the first release. A payload that grows a field later must not
 * be readable by an older shell as if the field were absent — `v` is what makes
 * that a refusal instead of a silent downgrade.
 */

import type { ConnectCandidate, ConnectRouteKind } from '@/shared/lib/connect/types';

/** The scheme the shells register and the desktop shells accept as a paste. */
export const PAIRING_SCHEME = 'kabmo';
export const PAIRING_HOST = 'connect';
export const PAIRING_VERSION = 1;

/** Longest payload accepted, so a hostile QR cannot make the parser allocate. */
export const MAX_PAIRING_PAYLOAD_LENGTH = 8_192;

export interface PairingPayload {
  v: typeof PAIRING_VERSION;
  pairingId: string;
  /** One-time secret. Consumed by the first successful claim. */
  secret: string;
  /** Stable identity of the server, pinned by the device. */
  serverId: string;
  /** The server's display name, so the phone can label it. */
  label: string;
  /** ISO timestamp. A payload past this is refused before any network call. */
  expiresAt: string;
  candidates: ConnectCandidate[];
}

const ROUTE_KINDS: readonly ConnectRouteKind[] = ['cloudflare', 'lan', 'tailscale'];

function isRouteKind(value: unknown): value is ConnectRouteKind {
  return typeof value === 'string' && (ROUTE_KINDS as readonly string[]).includes(value);
}

/** An origin with no path, no query and no trailing slash, or null. */
export function normalizeOrigin(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    parsed.hash = '';
    parsed.search = '';
    return parsed.origin;
  } catch {
    return null;
  }
}

function base64UrlEncode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(value: string): string | null {
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/** Keep only the fields a candidate is allowed to carry. */
function normalizeCandidate(value: unknown): ConnectCandidate | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!isRouteKind(record.kind)) return null;
  const url = normalizeOrigin(record.url);
  if (!url) return null;
  return { kind: record.kind, url };
}

/**
 * A payload from parsed JSON, or null.
 *
 * Every field is checked rather than trusted: this object arrives from a camera
 * and is the input to a request that hands out a credential.
 */
export function normalizePairingPayload(value: unknown, now: number = Date.now()): PairingPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.v !== PAIRING_VERSION) return null;

  const pairingId = typeof record.pairingId === 'string' ? record.pairingId.trim() : '';
  const secret = typeof record.secret === 'string' ? record.secret.trim() : '';
  const serverId = typeof record.serverId === 'string' ? record.serverId.trim() : '';
  const label = typeof record.label === 'string' ? record.label.trim() : '';
  const expiresAt = typeof record.expiresAt === 'string' ? record.expiresAt.trim() : '';
  if (!pairingId || !secret || !serverId || !expiresAt) return null;

  const expires = Date.parse(expiresAt);
  if (!Number.isFinite(expires) || expires <= now) return null;

  const candidates = Array.isArray(record.candidates)
    ? record.candidates
        .map(normalizeCandidate)
        .filter((candidate): candidate is ConnectCandidate => candidate !== null)
    : [];
  if (candidates.length === 0) return null;

  return {
    v: PAIRING_VERSION,
    pairingId,
    secret,
    serverId,
    label: label || 'Kabmo',
    expiresAt,
    candidates,
  };
}

/**
 * The encoded body alone, for a URL fragment.
 *
 * A fragment is never sent to the server, so the one-time secret in it does not
 * reach an access log, a proxy, or a `Referer`. The browser pairing page reads
 * it with `location.hash`; the deep link below carries the same bytes in a query
 * parameter, which is acceptable only because a `kabmo://` URL is handed to an
 * app rather than requested over the network.
 */
export function encodePairingFragment(payload: PairingPayload): string {
  const normalized = normalizePairingPayload(payload);
  if (!normalized) throw new Error('Invalid pairing payload');
  return base64UrlEncode(JSON.stringify(normalized));
}

/** The deep link a QR encodes for a native shell. */
export function encodePairingPayload(payload: PairingPayload): string {
  const params = new URLSearchParams();
  params.set('v', String(PAIRING_VERSION));
  params.set('p', encodePairingFragment(payload));
  return `${PAIRING_SCHEME}://${PAIRING_HOST}?${params.toString()}`;
}

/**
 * A payload from a scanned or pasted string, or null.
 *
 * Parsed by hand rather than through `new URL`: an old Android WebView (114)
 * mis-parses a non-special scheme, yielding an empty hostname and a path of
 * `//connect`, which made a valid link look invalid. The head is matched with a
 * regex and the two parameters are read off the query string directly.
 */
export function parsePairingPayload(value: string, now: number = Date.now()): PairingPayload | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_PAIRING_PAYLOAD_LENGTH) return null;

  const question = trimmed.indexOf('?');
  if (question === -1) return null;
  const head = trimmed.slice(0, question);
  if (!new RegExp(`^${PAIRING_SCHEME}://${PAIRING_HOST}/?$`, 'i').test(head)) return null;

  let version: string | null = null;
  let encoded: string | null = null;
  for (const part of trimmed.slice(question + 1).split('&')) {
    const equals = part.indexOf('=');
    if (equals === -1) continue;
    const key = part.slice(0, equals);
    const raw = part.slice(equals + 1);
    if (key === 'v') version = raw;
    else if (key === 'p') encoded = raw;
  }
  if (version !== String(PAIRING_VERSION) || !encoded) return null;
  return decodeFragment(encoded, now);
}

/**
 * A payload from the fragment of a browser pairing link, or null.
 *
 * The QR encodes `https://<address>/pair#<fragment>`, so a device that decoded
 * the code from a screenshot has this form rather than the deep link. Both are
 * accepted by {@link parsePairingLink}, which is what a scanner should call.
 */
export function parsePairingFragment(fragment: string, now: number = Date.now()): PairingPayload | null {
  const trimmed = fragment.trim().replace(/^#/, '');
  if (!trimmed) return null;
  return decodeFragment(trimmed, now);
}

/**
 * A payload from either form a QR can hold, or null.
 *
 * One entry point for a scanner: the code may be the browser link (what this
 * server encodes) or the deep link (what a native shell registers), and the
 * caller should not have to know which.
 */
export function parsePairingLink(value: string, now: number = Date.now()): PairingPayload | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.toLowerCase().startsWith(`${PAIRING_SCHEME}://`)) return parsePairingPayload(trimmed, now);
  const hash = trimmed.indexOf('#');
  if (hash === -1) return null;
  return parsePairingFragment(trimmed.slice(hash + 1), now);
}

/** Decode one base64url body into a validated payload. */
function decodeFragment(encoded: string, now: number): PairingPayload | null {
  if (!encoded || encoded.length > MAX_PAIRING_PAYLOAD_LENGTH) return null;
  const decoded = base64UrlDecode(encoded);
  if (!decoded || decoded.length > MAX_PAIRING_PAYLOAD_LENGTH) return null;
  try {
    return normalizePairingPayload(JSON.parse(decoded) as unknown, now);
  } catch {
    return null;
  }
}
