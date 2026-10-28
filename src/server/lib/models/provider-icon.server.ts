/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Keeping a provider's web icon fresh: fetch once, store the bytes, stamp a
 * version onto the provider item.
 *
 * The panel must never wait on a third party. `GET /api/settings/providers` is
 * the settings screen's first paint and it lists ~100 providers, so a fetch per
 * provider inside the request would make opening the panel depend on 100
 * foreign hosts. Instead:
 *
 * - the LOADER reads the stored stamps (one query, no bytes) and puts
 *   `iconUrl` on the items whose icon is already known;
 * - a background pass fetches the ones that are missing or stale, deduped per
 *   slug and capped in concurrency, and drops the registry cache when it stored
 *   something — so the next publish carries the new URLs.
 *
 * Freshness is asymmetric on purpose: a HIT is good for a week (a site's logo
 * changes rarely), a MISS for a day (a gateway that was down at 09:00 may be up
 * at 17:00, but retrying a 4s timeout on every panel open is not a cost worth
 * paying).
 */

import { getDb } from '@/server/db.server';
import { invalidateModelsCaches } from '@/shared/lib/models/server-cache';
import type { ProviderItem } from '@/shared/types';
import { fetchProviderIcon } from '@/server/lib/models/provider-icon-fetch';
import {
  readProviderIcon,
  readProviderIconStamps,
  writeProviderIcon,
  type StoredProviderIcon,
} from '@/server/lib/models/provider-icon-store.server';
import { isMockMode } from '@/server/mock.server';

const HIT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 24 * 60 * 60 * 1000;
/** Concurrent fetches across all providers: enough to fill a panel quickly. */
const CONCURRENCY = 4;

/** Slugs a fetch is in flight for, so a re-render cannot start a second one. */
const inFlight = new Set<string>();

export interface ProviderIconTarget {
  slug: string;
  baseUrl?: string;
}

function isFresh(icon: StoredProviderIcon, now: number): boolean {
  const ttl = icon.status === 'ok' ? HIT_TTL_MS : MISS_TTL_MS;
  return now - icon.fetchedAt < ttl;
}

/**
 * The URL a provider's icon is served from, versioned by its fetch time.
 *
 * The version is in the QUERY, not in an ETag alone, because the item travels
 * through several caches (the realtime topic, the panel's own state) and a
 * changed icon at an unchanged URL is a stale picture with no way to notice.
 */
export function providerIconUrl(slug: string, fetchedAt: number): string {
  return `/api/provider-icon?slug=${encodeURIComponent(slug)}&v=${fetchedAt}`;
}

/** Slug → the URL its stored icon is served from, for providers that have one. */
export async function readProviderIconUrls(): Promise<Map<string, string>> {
  if (isMockMode()) return new Map();
  try {
    const db = await getDb();
    const stamps = await readProviderIconStamps(db);
    const urls = new Map<string, string>();
    for (const [slug, stamp] of stamps) {
      if (stamp.status !== 'ok') continue;
      urls.set(slug, providerIconUrl(slug, stamp.fetchedAt));
    }
    return urls;
  } catch {
    // no-excuse-ok: catch — the icon is decoration; a read failure must not stop
    // the provider list from loading.
    return new Map();
  }
}

/**
 * Fetch and store one provider's icon when it is missing or stale.
 *
 * Returns true when something was WRITTEN, so the caller knows whether the
 * registry cache has to be dropped. Never throws.
 */
export async function ensureProviderIcon(target: ProviderIconTarget): Promise<boolean> {
  const slug = target.slug.trim();
  if (!slug || !target.baseUrl || isMockMode()) return false;
  if (inFlight.has(slug)) return false;
  inFlight.add(slug);
  try {
    const db = await getDb();
    const stored = await readProviderIcon(db, slug);
    if (stored && isFresh(stored, Date.now())) return false;

    const icon = await fetchProviderIcon(target.baseUrl);
    await writeProviderIcon(db, icon
      ? {
        slug,
        status: 'ok',
        mime: icon.mime,
        bytes: icon.bytes,
        source: icon.source,
        fetchedAt: Date.now(),
      }
      : {
        slug,
        status: 'missing',
        error: 'no usable icon on the endpoint host',
        fetchedAt: Date.now(),
      });
    return true;
  } catch (error) {
    // no-excuse-ok: catch — a failed icon is a fallback mark, never an error the
    // provider list reports.
    console.error(`[kabmo] provider icon failed for ${slug}:`, error instanceof Error ? error.message : error);
    return false;
  } finally {
    inFlight.delete(slug);
  }
}

/**
 * Refresh every target that needs it, at most {@link CONCURRENCY} at a time.
 * Resolves to how many rows were written.
 */
export async function ensureProviderIcons(targets: ProviderIconTarget[]): Promise<number> {
  if (isMockMode() || targets.length === 0) return 0;
  const queue = targets.filter((target) => target.baseUrl);
  let written = 0;
  let cursor = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const target = queue[index];
      if (!target) return;
      if (await ensureProviderIcon(target)) written += 1;
    }
  });
  await Promise.all(workers);
  return written;
}

/** The stored bytes for one provider, or null. */
export async function readProviderIconBytes(slug: string): Promise<StoredProviderIcon | null> {
  if (isMockMode()) return null;
  const db = await getDb();
  const icon = await readProviderIcon(db, slug);
  return icon && icon.status === 'ok' && icon.bytes ? icon : null;
}

/**
 * Stamp `iconUrl` onto every provider whose icon is already stored, and kick off
 * the fetch for the ones that are not.
 *
 * The caller is the registry merge, which runs on the panel's first paint and
 * on every publish. Two rules make that affordable:
 *
 * - the READ is one query of stored STAMPS, never the bytes, so the payload
 *   stays small and the request never waits on a third-party host;
 * - the FETCH is a background pass that drops the registry cache when it stored
 *   something, so the next publish carries the new URLs (the panel subscribes
 *   to that signal).
 */
export async function stampProviderIcons(providers: ProviderItem[]): Promise<ProviderItem[]> {
  if (providers.length === 0) return providers;
  const urls = await readProviderIconUrls();
  if (urls.size === 0) {
    scheduleIconFetch(providers);
    return providers;
  }
  const stamped = providers.map((provider) => {
    const url = urls.get(provider.slug.trim().toLowerCase());
    return url ? { ...provider, iconUrl: url } : provider;
  });
  scheduleIconFetch(stamped);
  return stamped;
}

/**
 * Fetch the icons the list does not have yet, without making the caller wait.
 *
 * A `models.yml` provider whose favicon has never been read is exactly the case
 * this exists for — but a request that blocks on a third-party host is a
 * settings panel that hangs when that host is down. The pass is deduped per
 * slug inside `ensureProviderIcons`.
 */
function scheduleIconFetch(providers: ProviderItem[]): void {
  const targets = providers
    .filter((provider) => provider.inModelsYml === true && Boolean(provider.baseUrl) && !provider.iconUrl)
    .map((provider) => ({ slug: provider.slug, baseUrl: provider.baseUrl as string }));
  if (targets.length === 0) return;
  void ensureProviderIcons(targets)
    .then((written) => {
      if (written > 0) invalidateModelsCaches();
    })
    .catch(() => {
      // no-excuse-ok: catch — an icon is decoration; a background failure must
      // not surface as an unhandled rejection.
    });
}
