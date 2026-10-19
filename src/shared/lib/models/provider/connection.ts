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
