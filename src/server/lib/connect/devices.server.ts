/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Devices that have redeemed a pairing code, and the tokens they hold.
 *
 * A device token is NOT the UI password and never becomes one. The password is
 * a single shared secret typed by a human; a device token is per-device, so
 * revoking one phone does not sign out the laptop, and a token that leaks
 * identifies exactly which device leaked it.
 *
 * Only the SHA-256 of a token is stored, for the same reason the agent tokens
 * are hashed: a copy of the database must not be replayable as a credential.
 * The gate runs on every request and is synchronous, so verified hashes are
 * mirrored in memory and a restart re-reads the table.
 */

import type { DbClient } from '@/server/lib/db/client';
import { getDb } from '@/server/db.server';
import type { ConnectRouteKind, PairedDevice } from '@/shared/lib/connect/types';

interface DeviceRow {
  id: string;
  name: string;
  platform: string;
  token_hash: string;
  route: string | null;
  rtt_ms: number | null;
  created_at: number;
  last_seen_at: number | null;
  revoked_at: number | null;
}

declare global {
  // eslint-disable-next-line no-var
  var __kabmoDeviceTokens: Map<string, string> | undefined;
  // eslint-disable-next-line no-var
  var __kabmoDeviceMarks: Map<string, number> | undefined;
}

function tokenCache(): Map<string, string> {
  globalThis.__kabmoDeviceTokens ??= new Map();
  return globalThis.__kabmoDeviceTokens;
}

/**
 * How often one device's connect timestamp is written.
 *
 * The gate runs on every request — pages, frames, WebSocket upgrades — so the
 * timestamp is throttled in memory: the first request after the window records,
 * and the next minute of traffic is free of writes.
 */
const CONNECT_MARK_INTERVAL_MS = 60_000;

function connectMarks(): Map<string, number> {
  globalThis.__kabmoDeviceMarks ??= new Map();
  return globalThis.__kabmoDeviceMarks;
}

/**
 * Record that `id` just used its token.
 *
 * This is the "last connect" the Settings page shows, and it is deliberately a
 * report of USE rather than of pairing: a device that paired last week and is
 * open right now must not read "last seen: last week". Never throws — the
 * request is already authorized and the timestamp is a display fact, not a
 * credential — and a failed write is retried by the next allowed window.
 */
export async function markDeviceConnected(id: string): Promise<void> {
  const marks = connectMarks();
  const now = Date.now();
  if (now - (marks.get(id) ?? 0) < CONNECT_MARK_INTERVAL_MS) return;
  marks.set(id, now);
  try {
    const db = await getDb();
    await db.run('UPDATE paired_devices SET last_seen_at = ? WHERE id = ?', [now, id]);
  } catch {
    // The device stays authorized; the next connection retries.
  }
}

export async function ensureConnectSchema(db: DbClient): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS paired_devices (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      platform TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      route TEXT,
      rtt_ms INTEGER,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER,
      revoked_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_paired_devices_token
      ON paired_devices (token_hash);
  `);
}

function hashToken(token: string): string {
  return new Bun.CryptoHasher('sha256').update(token).digest('hex');
}

/** Load every live token hash into the gate's cache. Call once at boot. */
export async function initDeviceTokens(): Promise<void> {
  try {
    const db = await getDb();
    const rows = (await db.all(
      'SELECT id, token_hash FROM paired_devices WHERE revoked_at IS NULL',
    )) as { id: string; token_hash: string }[];
    const next = new Map<string, string>();
    for (const row of rows) next.set(row.token_hash, row.id);
    globalThis.__kabmoDeviceTokens = next;
  } catch {
    // A database opened before this table existed has no device credentials;
    // the browser path is unaffected.
  }
}

/** The device id a bearer token belongs to, or null. Synchronous: the gate. */
export function verifyDeviceToken(token: string | null): string | null {
  if (!token) return null;
  return tokenCache().get(hashToken(token)) ?? null;
}

/**
 * The cookie a shell sets after pairing.
 *
 * A webview cannot attach an `Authorization` header to the requests it makes —
 * the page's own `fetch`, the WebSocket upgrades, the image loads. A cookie is
 * the one credential the platform sends on all of them, so the shell writes this
 * one for the server's origin and the gate reads it here.
 *
 * `HttpOnly` is set by the shell, not by this server: the value is written
 * through the platform's cookie store, which is the only place a webview cookie
 * can be created from native code.
 */
export const DEVICE_COOKIE = 'kabmo_device';

/** The device token carried as a cookie, or null. */
export function readDeviceCookie(request: Request): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const segment of header.split(';')) {
    const index = segment.indexOf('=');
    if (index === -1) continue;
    if (segment.slice(0, index).trim() !== DEVICE_COOKIE) continue;
    const value = segment.slice(index + 1).trim();
    if (!value) return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}

/** Mint a token for a device that just redeemed a pairing code. */
export async function mintDeviceToken(input: {
  name: string;
  platform: string;
}): Promise<{ id: string; token: string }> {
  const id = crypto.randomUUID();
  const token = `kabmo_device_${crypto.randomUUID().replace(/-/g, '')}`;
  const hash = hashToken(token);
  const db = await getDb();
  await db.run(
    `INSERT INTO paired_devices (id, name, platform, token_hash, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [id, input.name.trim() || 'Device', input.platform.trim() || 'unknown', hash, Date.now()],
  );
  tokenCache().set(hash, id);
  return { id, token };
}

/** Every device, newest first, revoked ones included so the page can say so. */
export async function listPairedDevices(): Promise<PairedDevice[]> {
  const db = await getDb();
  const rows = (await db.all(
    `SELECT id, name, platform, route, rtt_ms, created_at, last_seen_at, revoked_at
       FROM paired_devices
      WHERE revoked_at IS NULL
      ORDER BY created_at DESC`,
  )) as DeviceRow[];
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    platform: row.platform,
    route: (row.route as ConnectRouteKind | null) ?? null,
    rttMs: row.rtt_ms,
    lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

/** Cut a device off. The token stops verifying on the next request. */
export async function revokeDevice(id: string): Promise<boolean> {
  const db = await getDb();
  const row = (await db.get('SELECT token_hash FROM paired_devices WHERE id = ?', [id])) as
    | { token_hash: string }
    | undefined;
  if (!row) return false;
  await db.run('UPDATE paired_devices SET revoked_at = ? WHERE id = ?', [Date.now(), id]);
  tokenCache().delete(row.token_hash);
  connectMarks().delete(id);
  return true;
}

/**
 * Record the route a device reported, so the page can show which one it uses.
 *
 * Best-effort: a failed write must not fail the request that carried it, and the
 * column is a display fact rather than a security one.
 */
export async function touchDevice(
  id: string,
  report: { route: ConnectRouteKind; rttMs: number } | null,
): Promise<void> {
  try {
    const db = await getDb();
    const now = Date.now();
    await db.run(
      'UPDATE paired_devices SET last_seen_at = ?, route = COALESCE(?, route), rtt_ms = COALESCE(?, rtt_ms) WHERE id = ?',
      [now, report?.route ?? null, report?.rttMs ?? null, id],
    );
    // The gate would otherwise write the same timestamp immediately after.
    connectMarks().set(id, now);
  } catch {
    // See above: a display fact, not a credential.
  }
}
