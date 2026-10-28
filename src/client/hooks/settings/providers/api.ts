/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The settings API calls behind Settings → Providers.
 *
 * Split from the hook so the hook holds state transitions only — each of these
 * is a request whose failure has to be reported to the user, and keeping them
 * here means the "what does the server answer" contract has one home.
 */

import type { PresetProviderOption, ProviderItem, ProviderModel } from '@/shared/types';

export interface ProviderSettingsPayload {
  providers: ProviderItem[];
  presetProviders?: PresetProviderOption[];
  /** Why the CLI model catalog could not be read, when it could not. */
  catalogError?: string;
}

/** Load the merged provider registry (omp's sources + Kabmo overlay). */
export async function loadProvidersFromApi(): Promise<ProviderSettingsPayload | null> {
  try {
    const response = await fetch('/api/settings/providers');
    const data = await response.json() as Partial<ProviderSettingsPayload>;
    if (!Array.isArray(data?.providers)) return null;
    return {
      providers: data.providers,
      ...(data.presetProviders ? { presetProviders: data.presetProviders } : {}),
      ...(typeof data.catalogError === 'string' ? { catalogError: data.catalogError } : {}),
    };
  } catch (error) {
    console.error('Failed to load providers from API:', error);
    return null;
  }
}

export interface ModelOverrideResult {
  ok: boolean;
  written?: boolean;
  reason?: string;
  error?: string;
}

/**
 * Write the per-model knobs omp honours (`maxTokens`, reasoning effort) into
 * models.yml `modelOverrides`. Writing only Kabmo overlay left the
 * controls inert — omp never read them.
 */
export async function saveModelOverrideRemote(
  providerSlug: string,
  modelId: string,
  updates: Partial<ProviderModel>,
): Promise<ModelOverrideResult> {
  const body: Record<string, unknown> = { provider: providerSlug, modelId };
  if ('maxTokens' in updates) body.maxTokens = updates.maxTokens ?? null;
  if ('reasoningEffort' in updates) body.reasoningEffort = updates.reasoningEffort ?? null;
  // Nothing omp would read — the overlay update alone is the whole change.
  if (Object.keys(body).length === 2) return { ok: true, written: false };
  try {
    const response = await fetch('/api/settings/model-override', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json() as { success?: boolean; written?: boolean; reason?: string; error?: string };
    if (!response.ok) return { ok: false, error: data.error || 'Failed to save the model configuration.' };
    return { ok: true, written: data.written, reason: data.reason };
  } catch (error) {
    console.error('Failed to save model override:', error);
    return { ok: false, error: 'Failed to save the model configuration.' };
  }
}
