/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * GET  /api/provider-icon?slug=<slug>  — a provider's fetched web icon.
 * POST /api/provider-icon              — forget it and fetch again.
 *
 * The bytes are the provider site's own logo, stored by
 * `provider-icon.server.ts`. Served from here rather than inlined into the
 * provider payload because that payload is the settings panel's first paint and
 * an icon is ~10-50 KB: inlining 100 of them would be a multi-megabyte response
 * for a list of names.
 *
 * `v` in the query is the fetch time, so the URL changes when the icon does —
 * which is what makes `immutable` safe. A request without a version still
 * answers, with `no-cache` instead: an old bookmark must not pin a stale image.
 *
 * The bytes are untrusted input from a third-party host, so:
 * - the `content-type` is the one derived from the MAGIC BYTES at store time;
 * - `X-Content-Type-Options: nosniff` stops a browser from reinterpreting it;
 * - `Content-Security-Policy: default-src 'none'` means an SVG served here
 *   cannot run script if a reader opens it directly (the same guard the wiki
 *   asset route applies).
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { json } from '@/server/lib/remix-compat';
import { getDb } from '@/server/db.server';
import { isMockMode } from '@/server/mock.server';
import { deleteProviderIcon } from '@/server/lib/models/provider-icon-store.server';
import { ensureProviderIcon, providerIconUrl, readProviderIconBytes } from '@/server/lib/models/provider-icon.server';
import { invalidateModelsCaches } from '@/shared/lib/models/server-cache';

const ICON_HEADERS = {
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
} as const;

export async function loader({ request }: LoaderFunctionArgs): Promise<Response> {
  const url = new URL(request.url);
  const slug = url.searchParams.get('slug')?.trim() ?? '';
  if (!slug) return new Response('slug is required', { status: 400 });

  const icon = await readProviderIconBytes(slug);
  if (!icon?.bytes || !icon.mime) return new Response('no icon', { status: 404 });

  const versioned = url.searchParams.has('v');
  return new Response(icon.bytes, {
    headers: {
      'content-type': icon.mime,
      // A versioned URL names one fetch, so the bytes at it never change.
      'cache-control': versioned ? 'public, max-age=31536000, immutable' : 'no-cache',
      ...ICON_HEADERS,
    },
  });
}

/**
 * POST /api/provider-icon — refetch one provider's icon.
 *
 * The stored icon is good for a week, which is right for a logo that rarely
 * changes and wrong the moment a user renames their gateway or the site ships a
 * new mark. This is the control that says "look again now": it drops the row
 * (so the freshness check cannot short-circuit) and fetches synchronously,
 * because the caller is a button that must report what happened.
 *
 * Body: { slug, baseUrl? } → { ok, iconUrl? , error? }
 */
export async function action({ request }: ActionFunctionArgs): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
  const body = await request.json().catch(() => null) as { slug?: unknown; baseUrl?: unknown } | null;
  const slug = typeof body?.slug === 'string' ? body.slug.trim() : '';
  const baseUrl = typeof body?.baseUrl === 'string' ? body.baseUrl.trim() : '';
  if (!slug) return json({ error: 'slug is required' }, { status: 400 });
  if (isMockMode()) return json({ error: 'Icons are not fetched in mock mode' }, { status: 400 });
  if (!baseUrl) {
    return json({ error: 'This provider has no endpoint, so there is no site to read an icon from' }, { status: 400 });
  }

  const db = await getDb();
  await deleteProviderIcon(db, slug);
  const written = await ensureProviderIcon({ slug, baseUrl });
  // The panel's own copy came from the registry, so the cache has to move for
  // the new URL to be visible on the next read.
  if (written) invalidateModelsCaches();
  const stored = await readProviderIconBytes(slug);
  return json({
    ok: Boolean(stored),
    ...(stored ? { iconUrl: providerIconUrl(slug, stored.fetchedAt) } : {}),
    ...(stored ? {} : { error: 'No usable icon on that host or its base domain' }),
  });
}
