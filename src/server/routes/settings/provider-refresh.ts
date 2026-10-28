/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * POST /api/settings/providers/refresh — ask omp to re-run model discovery.
 *
 * This is omp's own refresh (`omp models refresh`), not a Kabmo-side probe of
 * each endpoint. Two reasons, and both are why the panel's old "fetch models"
 * could disagree with what the agent could actually run:
 *
 * - the CLI's `refresh` subcommand is the documented way to ignore the catalog
 *   cache, and it re-mints `!command` credentials on the way through;
 * - there is no provider-scoped equivalent to call — the RPC exposes no refresh
 *   command, and `ModelRegistry.refreshProvider` is internal to omp.
 *
 * The answer names what moved per provider, so a catalog-wide refresh is
 * reported as one instead of pretending to be per-provider discovery.
 *
 * Body: { slug? } → { success, ok, added, removed, changed[], providers }
 * `slug` narrows the REPORT to one provider; the refresh itself is the whole
 * catalog, because that is the only granularity omp offers.
 */

import { json } from '@/server/lib/remix-compat';
import type { ActionFunctionArgs } from '@/server/lib/remix-compat';
import { methodNotAllowed } from '@/server/lib/route-adapter';
import { isMockMode } from '@/server/mock.server';
import { getDb } from '@/server/db.server';
import { refreshModelCatalog } from '@/server/lib/models/catalog.server';
import { mergeProviders, PROVIDERS_SETTINGS_KEY } from '@/server/lib/models/provider-registry.server';
import { readSettingsJson } from '@/server/lib/db/settings-store';
import { invalidateModelsCaches } from '@/shared/lib/models/server-cache';
import type { ProviderItem } from '@/shared/types';

async function readOverlay(): Promise<ProviderItem[]> {
  const db = await getDb();
  const stored = await readSettingsJson<unknown>(db, PROVIDERS_SETTINGS_KEY, []);
  return Array.isArray(stored) ? (stored as ProviderItem[]) : [];
}

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return methodNotAllowed({ request, params });
  }
  try {
    const body = await request.json().catch(() => ({})) as { slug?: unknown };
    const slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : '';

    if (isMockMode()) {
      return json({
        success: false,
        ok: false,
        error: 'Refresh is unavailable in mock mode',
        added: 0,
        removed: 0,
        changed: [],
      }, { status: 400 });
    }

    const result = await refreshModelCatalog();
    if (!result.ok) {
      return json({ success: false, ...result }, { status: 502 });
    }
    // Every listing that moved means the registry did too — drop the caches so
    // the chat picker and the role dropdowns see the new rows immediately.
    invalidateModelsCaches();
    const merged = await mergeProviders(await readOverlay());
    const changed = slug ? result.changed.filter((entry) => entry.slug === slug) : result.changed;
    return json({
      success: true,
      ok: true,
      added: slug ? changed.reduce((sum, entry) => sum + Math.max(0, entry.after - entry.before), 0) : result.added,
      removed: slug ? changed.reduce((sum, entry) => sum + Math.max(0, entry.before - entry.after), 0) : result.removed,
      changed,
      providers: merged.providers,
      catalogError: merged.catalogError,
    });
  } catch (error) {
    return json({
      success: false,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}
