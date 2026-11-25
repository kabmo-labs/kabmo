/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Storing a provider's fetched web icon.
 *
 * The bytes live in Kabmo's database rather than in a temp directory or in the
 * settings blob, for the reasons each of those fails:
 *
 * - **A temp file is lost** on a container restart, and the panel would refetch
 *   every icon from a third party each time.
 * - **The settings blob is written by the modal** (`app_settings`), so an icon
 *   write would race a settings save for one row and one of them would lose.
 * - **A data URL in the provider payload** would put ~10-50 KB per provider into
 *   `GET /api/settings/providers` on every load, for a list of ~100 — that
 *   payload is the panel's first paint. The bytes are served by
 *   `GET /api/provider-icon` instead, and the item carries only a URL.
 *
 * A MISS is stored too (`status = 'missing'`): a private gateway, a host behind
 * auth and a site with no favicon all look the same from here, and without a
 * negative row every panel load would retry a 4s timeout per provider.
 */

import type { DbClient } from '@/server/lib/db/client';
import { drawableSvg } from '@/server/lib/models/provider-icon-svg';

const PROVIDER_ICON_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS provider_icons (
    slug TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    mime TEXT,
    bytes BLOB,
    source TEXT,
    error TEXT,
    fetched_at INTEGER NOT NULL
  );
`;

/** Idempotent: the provider-icon table, created on every database open. */
export async function ensureProviderIconSchema(db: DbClient): Promise<void> {
  await db.exec(PROVIDER_ICON_SCHEMA_SQL);
}

export interface StoredProviderIcon {
  slug: string;
  status: 'ok' | 'missing';
  mime?: string;
  bytes?: Uint8Array;
  source?: string;
  error?: string;
  fetchedAt: number;
}

/** One stored icon row, or null when this provider has never been fetched. */
export async function readProviderIcon(db: DbClient, slug: string): Promise<StoredProviderIcon | null> {
  const row = await db.get<{
    slug: string;
    status: string;
    mime: string | null;
    bytes: Uint8Array | null;
    source: string | null;
    error: string | null;
    fetched_at: number;
  }>(
    'SELECT slug, status, mime, bytes, source, error, fetched_at FROM provider_icons WHERE slug = ?',
    [slug],
  );
  if (!row) return null;
  return {
    slug: row.slug,
    status: row.status === 'ok' ? 'ok' : 'missing',
    ...(row.mime ? { mime: row.mime } : {}),
    ...(row.bytes ? { bytes: row.bytes } : {}),
    ...(row.source ? { source: row.source } : {}),
    ...(row.error ? { error: row.error } : {}),
    fetchedAt: row.fetched_at,
  };
}

/** Slug → status/fetch time for every stored icon. What the registry stamps. */
export async function readProviderIconStamps(
  db: DbClient,
): Promise<Map<string, { status: 'ok' | 'missing'; fetchedAt: number }>> {
  const rows = await db.all<{ slug: string; status: string; fetched_at: number }>(
    'SELECT slug, status, fetched_at FROM provider_icons',
  );
  const stamps = new Map<string, { status: 'ok' | 'missing'; fetchedAt: number }>();
  for (const row of rows) {
    stamps.set(row.slug, {
      status: row.status === 'ok' ? 'ok' : 'missing',
      fetchedAt: row.fetched_at,
    });
  }
  return stamps;
}

/** Write (or replace) one provider's icon row. */
export async function writeProviderIcon(db: DbClient, icon: StoredProviderIcon): Promise<void> {
  await db.run(
    `INSERT OR REPLACE INTO provider_icons (slug, status, mime, bytes, source, error, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      icon.slug,
      icon.status,
      icon.mime ?? null,
      icon.bytes ?? null,
      icon.source ?? null,
      icon.error ?? null,
      icon.fetchedAt,
    ],
  );
}

/** Forget one provider's icon, so the next read refetches it. */
export async function deleteProviderIcon(db: DbClient, slug: string): Promise<void> {
  await db.run('DELETE FROM provider_icons WHERE slug = ?', [slug]);
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

/**
 * Repair SVG icons stored before the fetch layer validated them.
 *
 * A site can serve an SVG that is well-formed to a lenient reader and broken to
 * a browser (`--` inside an XML comment is the measured case), and the old code
 * stored those bytes as `status = 'ok'`. The row then served `image/svg+xml`
 * that Chromium rejects, so the provider drew its initials while every API said
 * it had an icon.
 *
 * Sanitized bytes are written back with a NEW `fetched_at`, because that is the
 * version in the icon URL: reusing the old stamp would leave the browser's
 * immutable copy of the undecodable bytes in place. A document that cannot be
 * repaired is deleted, so the normal background pass fetches another candidate.
 *
 * Runs once per database open, after the table exists.
 */
export async function repairProviderIconSvgs(db: DbClient): Promise<number> {
  const rows = await db.all<{
    slug: string;
    bytes: Uint8Array | null;
    source: string | null;
  }>(
    "SELECT slug, bytes, source FROM provider_icons WHERE status = 'ok' AND mime = 'image/svg+xml'",
  );
  let repaired = 0;
  for (const row of rows) {
    const bytes = row.bytes;
    if (!bytes) {
      await deleteProviderIcon(db, row.slug);
      repaired += 1;
      continue;
    }
    const drawable = drawableSvg(bytes);
    if (!drawable) {
      await deleteProviderIcon(db, row.slug);
      repaired += 1;
      continue;
    }
    if (sameBytes(drawable, bytes)) continue;
    await writeProviderIcon(db, {
      slug: row.slug,
      status: 'ok',
      mime: 'image/svg+xml',
      bytes: drawable,
      ...(row.source ? { source: row.source } : {}),
      fetchedAt: Date.now(),
    });
    repaired += 1;
  }
  return repaired;
}
