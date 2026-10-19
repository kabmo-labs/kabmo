/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Assembly of the chat model registry that `GET /api/models` serves: the omp
 * registry (auth providers + models.yml) narrowed by the provider/model hides
 * the operator set, plus the live session's default model.
 *
 * Extracted from `routes/models/root.ts` so the route keeps only its loader and
 * action, and so the preference store can share the same model list.
 */

import { getDb } from '@/server/db.server';
import { PROVIDERS_SETTINGS_KEY } from '@/server/lib/models/provider-registry.server';
import { readSettingsJson } from '@/server/lib/db/settings-store';
import { readDisabledProviders } from '@/server/lib/omp/config/disabled-providers';
import { runUtilityCommand, type OmpModel } from '@/server/lib/omp/rpc/utility';
import { invalidateModelsCaches } from '@/shared/lib/models/server-cache';
import type { ModelsData, ProviderItem } from '@/shared/types';

const MODELS_CACHE_TTL_MS = 60_000;
export const SAFE_MODEL_LOAD_FAILURE_MESSAGE = 'Model list is temporarily unavailable. Check your configuration and try again.';

const modelNameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function compareModelEntries(a: { id: string; name: string; provider: string }, b: { id: string; name: string; provider: string }): number {
  return modelNameCollator.compare(a.name || a.id, b.name || b.id)
    || modelNameCollator.compare(a.provider, b.provider)
    || modelNameCollator.compare(a.id, b.id);
}

// "off" is always a valid selector; the concrete efforts come from the model's
// baked thinking metadata (omp: getSupportedEfforts = reasoning ? efforts : []).
function thinkingLevelsFor(model: OmpModel): string[] {
  if (!model.reasoning) return ['off'];
  return ['off', ...(model.thinking?.efforts ?? [])];
}

function supportsFastMode(model: OmpModel): boolean {
  return model.provider === 'anthropic' || model.provider === 'openai' || model.provider === 'google';
}

/**
 * Disabled providers recorded in Kabmo's own provider overlay. Used only
 * by the MOCK path of `/api/models`, which has no config.yml `disabledProviders`
 * to read — real mode gets the same answer natively.
 */
function isDisabledStoredProvider(value: unknown): value is ProviderItem {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as ProviderItem;
  return typeof candidate.slug === 'string' && candidate.disabled === true;
}

export async function readStoredProvidersForModels(): Promise<ProviderItem[]> {
  try {
    const db = await getDb();
    const parsed = await readSettingsJson<unknown>(db, PROVIDERS_SETTINGS_KEY, null);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isDisabledStoredProvider);
  } catch {
    return [];
  }
}

function hiddenModelKey(provider: string, modelId: string): string {
  return `${provider.trim().toLowerCase()}:${modelId}`;
}

async function readHiddenModelKeys(): Promise<Set<string>> {
  try {
    const db = await getDb();
    const parsed = await readSettingsJson<unknown>(db, PROVIDERS_SETTINGS_KEY, null);
    if (!Array.isArray(parsed)) return new Set();
    const hidden = new Set<string>();
    for (const provider of parsed) {
      if (typeof provider !== 'object' || provider === null) continue;
      const { slug, models } = provider as { slug?: unknown; models?: unknown };
      if (typeof slug !== 'string' || !Array.isArray(models)) continue;
      for (const model of models) {
        if (typeof model !== 'object' || model === null) continue;
        const { id, isVisible } = model as { id?: unknown; isVisible?: unknown };
        if (typeof id === 'string' && isVisible === false) hidden.add(hiddenModelKey(slug, id));
      }
    }
    return hidden;
  } catch {
    return new Set();
  }
}

/**
 * A model is offered only when its provider is neither disabled in omp's
 * config.yml (`disabledProviders`) nor carrying a per-model hide in the
 * Kabmo overlay. Disabling the provider is the coarse switch — Settings →
 * Providers flips it so the whole provider leaves the chat picker.
 */
function filterSelectableModels(
  available: OmpModel[],
  disabledProviders: Set<string>,
  hiddenModelKeys: Set<string>,
): OmpModel[] {
  return available.filter((model) => (
    !disabledProviders.has(model.provider)
    && !hiddenModelKeys.has(hiddenModelKey(model.provider, model.id))
  ));
}

function isOmpModelEntry(value: unknown): value is OmpModel {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as OmpModel;
  return typeof candidate.id === 'string' && typeof candidate.provider === 'string';
}

function isLoginProvider(value: unknown): value is { id: string; name: string; authenticated: boolean } {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { id?: unknown; name?: unknown; authenticated?: unknown };
  return typeof candidate.id === 'string'
    && typeof candidate.name === 'string'
    && typeof candidate.authenticated === 'boolean';
}

async function loadModels(): Promise<ModelsData> {
  const availableResponse = await runUtilityCommand<{ models?: unknown }>(
    { type: 'get_available_models' },
    120_000,
  );
  const available = Array.isArray(availableResponse.models)
    ? availableResponse.models
        .filter(isOmpModelEntry)
        .map((model) => ({
          ...model,
          name: typeof model.name === 'string' && model.name.trim().length > 0 ? model.name : model.id,
        }))
    : [];

  const disabledProviders = await readDisabledProviders();
  const hiddenModelKeys = await readHiddenModelKeys();
  const nameMap: Record<string, string> = {};
  const thinkingLevels: Record<string, string[]> = {};
  const modelList = filterSelectableModels(available, disabledProviders, hiddenModelKeys)
    .map((m) => ({
      id: m.id,
      name: m.name,
      provider: m.provider,
      thinkingLevels: thinkingLevelsFor(m),
      supportsFastMode: supportsFastMode(m),
      contextWindow: m.contextWindow ?? undefined,
      maxTokens: m.maxTokens ?? undefined,
      cost: m.cost,
    }))
    .sort(compareModelEntries);

  const loginResponse = await runUtilityCommand<{ providers?: unknown }>(
    { type: 'get_login_providers' },
    30_000,
  );
  const loginProviders = Array.isArray(loginResponse.providers)
    ? loginResponse.providers.filter(isLoginProvider)
    : [];
  const connectedProviders = loginProviders
    .filter((provider) => provider.authenticated)
    .map((provider) => ({ id: provider.id, name: provider.name, disabled: disabledProviders.has(provider.id) }));
  for (const m of available) {
    const key = `${m.provider}:${m.id}`;
    nameMap[key] = m.name;
    thinkingLevels[key] = thinkingLevelsFor(m);
  }

  let defaultModel: { provider: string; modelId: string } | null = null;
  try {
    const state = await runUtilityCommand<{ model?: { provider?: string; id?: string } }>(
      { type: 'get_state' },
      30_000,
    );
    const provider = state.model?.provider;
    const modelId = state.model?.id;
    if (provider && modelId && available.some((m) => m.provider === provider && m.id === modelId)) {
      defaultModel = { provider, modelId };
    }
  } catch {
    // Default model is cosmetic — the models list is still useful without it.
  }

  return { models: nameMap, modelList, defaultModel, thinkingLevels, connectedProviders };
}

export const EMPTY_MODELS: ModelsData = {
  models: {},
  modelList: [],
  defaultModel: null,
  thinkingLevels: {},
};

export async function loadModelsWithCache(): Promise<ModelsData> {
  const cached = globalThis.__kabmoModelsCache;
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  const data = await loadModels();
  globalThis.__kabmoModelsCache = { data, expiresAt: Date.now() + MODELS_CACHE_TTL_MS };
  return data;
}

export function invalidateModelsCache(): void {
  invalidateModelsCaches();
}
