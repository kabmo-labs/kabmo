/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * PUT /api/settings/provider-entry — edit an existing `models.yml` provider.
 *
 * The provider panel's "Edit connection" control used to write Kabmo's SQLite
 * overlay, which the registry merge then discards for any slug models.yml owns
 * (`applyStoredOverrides` only carries per-model state). The new key or endpoint
 * was therefore stored where nothing reads it: the panel said "connected", omp
 * kept using the old credential, and a reload reverted the display. This route
 * is the one that reaches the file omp actually reads.
 *
 * Body: { slug, baseUrl?, apiKey?, api?, auth?, discovery?, headers?,
 *   authHeader?, transport? }
 *   → { success, written, changed[], reason? }
 *
 * `null` on a field REMOVES it; an absent field is left alone. An empty string
 * is treated as a removal, because a cleared input is how a user says "no
 * value" and omp rejects an empty `baseUrl`/`apiKey` outright.
 */

import { json } from '@/server/lib/remix-compat';
import type { ActionFunctionArgs } from '@/server/lib/remix-compat';
import { methodNotAllowed } from '@/server/lib/route-adapter';
import { isMockMode } from '@/server/mock.server';
import {
  updateOmpProviderEntry,
  type OmpProviderEntryPatch,
  type ProviderDiscoveryConfig,
} from '@/server/lib/omp/config/provider-entry';
import {
  isOmpProviderApi,
  isProviderAuthMode,
  isProviderDiscoveryType,
} from '@/shared/lib/models/provider/dialect';
import { invalidateModelsCaches } from '@/shared/lib/models/server-cache';

/**
 * The discovery block from the client: a type plus the knobs that type accepts.
 * An unknown type is dropped rather than written — omp disables every custom
 * provider in the file over one bad field.
 */
function readDiscovery(value: unknown): ProviderDiscoveryConfig | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'object' || value === undefined) return undefined;
  const record = value as Record<string, unknown>;
  if (!isProviderDiscoveryType(record.type)) return undefined;
  return {
    type: record.type,
    ...(typeof record.timeoutMs === 'number' ? { timeoutMs: record.timeoutMs } : {}),
    ...(typeof record.injectV1 === 'boolean' ? { injectV1: record.injectV1 } : {}),
    ...(typeof record.advertisedReasoning === 'boolean' ? { advertisedReasoning: record.advertisedReasoning } : {}),
  };
}

/** A header map from the client: string values only, empty keys dropped. */
function readHeaders(value: unknown): Record<string, string> | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'object' || value === undefined) return undefined;
  const entries = Object.entries(value).flatMap(([key, header]) => {
    const name = key.trim();
    if (!name || typeof header !== 'string') return [];
    return [[name, header.trim()] as [string, string]];
  });
  return Object.fromEntries(entries);
}

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== 'PUT' && request.method !== 'POST') {
    return methodNotAllowed({ request, params });
  }
  try {
    const body = await request.json() as Record<string, unknown>;
    const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
    if (!slug) return json({ error: 'slug is required' }, { status: 400 });

    const patch: OmpProviderEntryPatch = {
      ...(typeof body.baseUrl === 'string' || body.baseUrl === null ? { baseUrl: body.baseUrl } : {}),
      ...(typeof body.apiKey === 'string' || body.apiKey === null ? { apiKey: body.apiKey } : {}),
      // An unrecognized dialect is dropped rather than written: omp disables
      // EVERY custom provider in the file over one unknown `api`.
      ...(isOmpProviderApi(body.api) ? { api: body.api } : {}),
      ...(isProviderAuthMode(body.auth) ? { auth: body.auth } : {}),
      ...(readDiscovery(body.discovery) !== undefined
        ? { discovery: readDiscovery(body.discovery) }
        : {}),
      ...(body.authHeader === true || body.authHeader === false ? { authHeader: body.authHeader } : {}),
      ...(body.transport === 'pi-native' || body.transport === null ? { transport: body.transport } : {}),
    };
    const headers = readHeaders(body.headers);
    if (headers !== undefined) patch.headers = headers;

    if (Object.keys(patch).length === 0) {
      return json({ error: 'nothing to change' }, { status: 400 });
    }
    // Mock mode has no models.yml; the caller's overlay row is the store.
    if (isMockMode()) return json({ success: true, written: false, isMock: true, changed: [] });

    const result = await updateOmpProviderEntry(slug, patch);
    if (result.written) invalidateModelsCaches();
    return json({ success: result.written, ...result }, { status: result.written ? 200 : 400 });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
