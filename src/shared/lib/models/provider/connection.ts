/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Client writes for the provider settings. Two concerns share one endpoint: the
 * Kabmo-local overlay (per-model visibility + sampling config) and the
 * omp-native connect/disconnect flag. Both reshape the chat model picker, so
 * both notify it only AFTER the server confirmed the write — notifying first
 * would re-cache the pre-mutation list for another 60s.
 */

import type { ProviderItem } from '@/shared/types';
import type {
  OmpProviderApi,
  ProviderAuthMode,
  ProviderDiscoveryType,
} from '@/shared/types/settings/provider';
import { notifyModelsUpdated } from '@/shared/lib/models/client';

const PROVIDERS_ENDPOINT = '/api/settings/providers';

async function postProviders(body: unknown): Promise<ProviderItem[] | null> {
  const response = await fetch(PROVIDERS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await response.json()) as { providers?: unknown; error?: string };
  if (!response.ok) {
    throw new Error(data?.error || `Providers request failed (HTTP ${response.status})`);
  }
  notifyModelsUpdated();
  return Array.isArray(data.providers) ? (data.providers as ProviderItem[]) : null;
}

/** Stores the per-model overlay (visibility, sampling config) and refreshes the picker. */
export function saveProviderOverlay(providers: ProviderItem[]): Promise<ProviderItem[] | null> {
  return postProviders({ providers });
}

/** Flips a provider in omp's own config.yml disabledProviders list. */
export function setProviderEnabled(slug: string, enabled: boolean): Promise<ProviderItem[] | null> {
  return postProviders(enabled ? { enableProvider: slug } : { disableProvider: slug });
}

/** omp's discovery block: a type plus the knobs that type accepts. */
export interface ProviderDiscoveryConfig {
  type: ProviderDiscoveryType;
  timeoutMs?: number;
  injectV1?: boolean;
  advertisedReasoning?: boolean;
}

/** One provider entry's editable fields; `null` removes the field. */
export interface ProviderEntryPatch {
  baseUrl?: string | null;
  apiKey?: string | null;
  api?: OmpProviderApi | null;
  auth?: ProviderAuthMode | null;
  discovery?: ProviderDiscoveryConfig | null;
  headers?: Record<string, string> | null;
  authHeader?: boolean | null;
  transport?: 'pi-native' | null;
}

export interface ProviderEntryResult {
  ok: boolean;
  changed?: string[];
  reason?: string;
  error?: string;
}

/**
 * Write a provider's endpoint / credential / dialect into `models.yml`.
 *
 * The overlay POST above cannot do this: the registry merge discards an overlay
 * row for any slug `models.yml` owns, so a rotated key saved there was never
 * read by omp. This route edits the file itself.
 */
export async function saveProviderEntry(
  slug: string,
  patch: ProviderEntryPatch,
): Promise<ProviderEntryResult> {
  try {
    const response = await fetch('/api/settings/provider-entry', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, ...patch }),
    });
    const data = await response.json() as ProviderEntryResult;
    if (!response.ok) {
      return { ok: false, error: data.error ?? data.reason ?? `HTTP ${response.status}` };
    }
    notifyModelsUpdated();
    return { ...data, ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Network error while saving the provider' };
  }
}

export interface ProviderIconRefreshResult {
  ok: boolean;
  iconUrl?: string;
  error?: string;
}

/**
 * Refetch one provider's web icon from its own site.
 *
 * The stored icon is good for a week, which is right for a logo that rarely
 * changes and wrong the moment the site ships a new one — this is the control
 * that says "look again now".
 */
export async function refreshProviderIcon(slug: string, baseUrl: string): Promise<ProviderIconRefreshResult> {
  try {
    const response = await fetch('/api/provider-icon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, baseUrl }),
    });
    const data = await response.json() as ProviderIconRefreshResult;
    if (!response.ok) return { ok: false, error: data.error ?? `HTTP ${response.status}` };
    return data;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Network error while fetching the icon' };
  }
}

export interface CatalogRefreshResult {
  ok: boolean;
  added: number;
  removed: number;
  changed: Array<{ slug: string; before: number; after: number }>;
  providers?: ProviderItem[];
  error?: string;
}

/**
 * Ask omp to re-run model discovery (`omp models refresh`).
 *
 * This is omp's own refresh, not a Kabmo-side probe: the CLI re-mints
 * `!command` credentials and updates the catalog cache the chat picker reads,
 * so the panel and the agent cannot disagree about what a provider serves.
 * `slug` only narrows the REPORT — omp offers no provider-scoped refresh.
 */
export async function refreshProviderCatalog(slug?: string): Promise<CatalogRefreshResult> {
  try {
    const response = await fetch('/api/settings/providers/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(slug ? { slug } : {}),
    });
    const data = await response.json() as CatalogRefreshResult;
    if (!response.ok) {
      return {
        ok: false,
        added: 0,
        removed: 0,
        changed: [],
        error: data.error ?? `HTTP ${response.status}`,
      };
    }
    notifyModelsUpdated();
    return data;
  } catch (error) {
    return {
      ok: false,
      added: 0,
      removed: 0,
      changed: [],
      error: error instanceof Error ? error.message : 'Network error while refreshing models',
    };
  }
}

export interface ProviderDeleteResult {
  ok: boolean;
  providers?: ProviderItem[];
  /** True when a `models.yml` entry was actually removed. */
  removedFromOmp?: boolean;
  /** How many model entries went with it. */
  modelsRemoved?: number;
  /** The overlay row went but the file cleanup failed — surfaced, not swallowed. */
  warning?: string;
  error?: string;
}

/**
 * Delete a provider: its Kabmo overlay row AND its `models.yml` entry.
 *
 * The provider is identified by the id the registry served, because a provider
 * that exists only in models.yml has no overlay row to match on — the server
 * resolves the id against the merged registry to find the slug to unregister.
 */
export async function deleteProvider(id: string): Promise<ProviderDeleteResult> {
  try {
    const response = await fetch(`${PROVIDERS_ENDPOINT}?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    const data = await response.json() as ProviderDeleteResult;
    if (!response.ok) {
      return { ok: false, error: data?.error || `Delete failed (HTTP ${response.status})` };
    }
    // The provider — and every model it served — leaves the chat picker.
    notifyModelsUpdated();
    return { ...data, ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Network error while deleting the provider',
    };
  }
}
