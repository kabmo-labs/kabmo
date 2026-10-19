/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Provider registry assembly for the provider settings. Folds the three omp
 * sources — auth login providers, models.yml registrations, config.yml
 * disabledProviders — with Kabmo's local SQLite overlay into the
 * ProviderItem list the settings UI renders. Server-only: reads omp config
 * files and drives the shared utility RPC process.
 */

import { readDisabledProviders } from '@/server/lib/omp/config/disabled-providers';
import { getModelsConfigPath, readNativeProviders } from '@/server/lib/omp/config/models-config';
import { runUtilityCommand, type OmpModel } from '@/server/lib/omp/rpc/utility';
import { disabledProviderItem, nativeProviderItem } from '@/server/lib/models/provider-items.server';
import { removeLegacyKenariModels } from '@/shared/lib/models/provider/cleanup';
import type { ProviderItem } from '@/shared/types';

/** app_settings key holding Kabmo-local provider overlay. */
export const PROVIDERS_SETTINGS_KEY = 'omp_providers_config';

const RPC_CACHE_TTL_MS = 60_000;

/** Minimal shape of a get_login_providers entry, as Kabmo reads it. */
export interface DetectedLoginProvider {
  id: string;
  name: string;
  authenticated: boolean;
}

function isDetectedLoginProvider(provider: unknown): provider is DetectedLoginProvider {
  return (
    typeof provider === 'object' && provider !== null
    && typeof (provider as { id?: unknown }).id === 'string'
    && typeof (provider as { name?: unknown }).name === 'string'
    && typeof (provider as { authenticated?: unknown }).authenticated === 'boolean'
  );
}

function isOmpModel(model: unknown): model is OmpModel {
  return (
    typeof model === 'object' && model !== null
    && typeof (model as OmpModel).id === 'string'
    && typeof (model as OmpModel).provider === 'string'
  );
}

export interface OmpRegistrySnapshot {
  /** Login providers omp reports (authenticated or not). */
  providers: DetectedLoginProvider[];
  /** Every model omp currently serves. */
  models: OmpModel[];
}

/**
 * Raw omp registry probe — the two commands that define "detected" for the
 * Kabmo: the login providers omp knows and the models they serve. Parsed here
 * once so the provider settings page and the startup banner count the same set.
 * Throws when the utility RPC is unreachable; each caller degrades its own way.
 */
export async function fetchOmpRegistrySnapshot(): Promise<OmpRegistrySnapshot> {
  const [loginResponse, modelsResponse] = await Promise.all([
    runUtilityCommand<{ providers?: unknown }>({ type: 'get_login_providers' }, 30_000),
    runUtilityCommand<{ models?: unknown }>({ type: 'get_available_models' }, 60_000),
  ]);
  return {
    providers: Array.isArray(loginResponse.providers) ? loginResponse.providers.filter(isDetectedLoginProvider) : [],
    models: Array.isArray(modelsResponse.models) ? modelsResponse.models.filter(isOmpModel) : [],
  };
}

/**
 * Provider registry straight from the omp agent: authenticated login providers
 * (omp auth) plus their registered models (get_available_models). This is the
 * source the composer's model dropdown already uses via /api/models.
 */
async function loadRpcProviderItems(): Promise<ProviderItem[]> {
  const cached = globalThis.__kabmoProvidersRpcCache;
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  try {
    const { providers: loginProviders, models: available } = await fetchOmpRegistrySnapshot();
    const disabled = await readDisabledProviders().catch(() => new Set<string>());

    const items = loginProviders.map((provider) => {
      const providerModels = available.filter((model) => model.provider === provider.id);
      const isDisabled = disabled.has(provider.id);
      return {
        id: `omp-auth-${provider.id}`,
        name: provider.name,
        slug: provider.id,
        icon: provider.id,
        status: (provider.authenticated && !isDisabled ? 'connected' : 'disconnected') as ProviderItem['status'],
        disabled: isDisabled,
        configuredIn: 'omp auth credentials',
        credentialSource: 'omp-auth' as const,
        models: providerModels.map((model) => ({
          id: model.id,
          name: typeof model.name === 'string' && model.name.length > 0 ? model.name : model.id,
          contextWindow: model.contextWindow ? `${Math.round(model.contextWindow / 1000)}K ctx` : '',
          hasTools: true,
          hasVision: false,
          isVisible: true,
        })),
      };
    });
    globalThis.__kabmoProvidersRpcCache = { data: items, expiresAt: Date.now() + RPC_CACHE_TTL_MS };
    return items;
  } catch {
    // RPC unavailable (cold start / omp busy) — degrade to the remaining sources.
    return [];
  }
}

function mergeProviderItems(existing: ProviderItem, incoming: ProviderItem): ProviderItem {
  const primary = existing.id.startsWith('omp-auth-') || !incoming.id.startsWith('omp-auth-')
    ? existing
    : incoming;
  const secondary = primary === existing ? incoming : existing;
  const knownModelIds = new Set<string>();
  const models = [...primary.models, ...secondary.models].filter((model) => {
    if (knownModelIds.has(model.id)) return false;
    knownModelIds.add(model.id);
    return true;
  });
  // Disable is a union, not a winner-takes-all: the two sources see different
  // halves of config.yml (auth sees login providers, native sees models.yml), so
  // a flag set on either side must survive the merge — otherwise the provider
  // re-enters the chat picker on the next reload.
  const disabled = primary.disabled === true || secondary.disabled === true;

  return {
    ...primary,
    name: primary.name === primary.slug && secondary.name !== secondary.slug
      ? secondary.name
      : primary.name,
    status: disabled
      ? 'disconnected'
      : primary.status === 'connected' || secondary.status === 'connected'
        ? 'connected'
        : primary.status,
    disabled,
    baseUrl: primary.baseUrl || secondary.baseUrl,
    apiKey: primary.apiKey || secondary.apiKey,
    // A models.yml entry means the endpoint and key live in that file, so the
    // provider is edited in place; the login-provider half of the merge only
    // says omp KNOWS the id. Preferring `omp-auth` here is what sent a keyless
    // local server into an OAuth flow it can never complete.
    credentialSource: primary.credentialSource === 'models.yml' || secondary.credentialSource === 'models.yml'
      ? 'models.yml'
      : primary.credentialSource ?? secondary.credentialSource,
    // A union, not a winner-takes-all: the two halves see different files
    // (auth sees login providers, native sees models.yml), and the flag decides
    // whether the delete button may appear at all.
    inModelsYml: primary.inModelsYml === true || secondary.inModelsYml === true,
    // Dialect fields come from whichever side knows them: the auth source
    // never carries them, the native models.yml source always does.
    api: primary.api ?? secondary.api,
    auth: primary.auth ?? secondary.auth,
    discovery: primary.discovery ?? secondary.discovery,
    configuredIn: primary.apiKey || primary.baseUrl ? primary.configuredIn : secondary.configuredIn,
    models,
  };
}

export function deduplicateProviderItems(items: ProviderItem[]): ProviderItem[] {
  const bySlug = new Map<string, ProviderItem>();
  for (const item of items) {
    const normalizedItem = {
      ...item,
      models: removeLegacyKenariModels(item, item.models),
    };
    // Identity is the provider's OWN slug. It used to fold every entry whose
    // name, slug or endpoint mentioned kenari onto one `kenari` key, which made
    // a second Kenari account (`kenari2`) indistinguishable from the first: the
    // two models.yml entries merged into a single row, the panel could only act
    // on the surviving slug, and a disconnect/delete hit one while omp still
    // served the other. The two halves of one provider already spell the same
    // slug (omp reports a models.yml provider under its models.yml key), so
    // nothing that genuinely is one provider stops merging.
    const key = normalizedItem.slug.trim().toLowerCase();
    const existing = bySlug.get(key);
    bySlug.set(key, existing ? mergeProviderItems(existing, normalizedItem) : normalizedItem);
  }
  return [...bySlug.values()];
}

/**
 * Re-apply Kabmo-local overlay onto freshly built registry entries. The
 * registry is authoritative for which providers/models exist, but the user's
 * own per-model choices (visibility, sampling config) exist only in SQLite —
 * without this, every reload rebuilds the list with isVisible: true and the
 * eye toggles silently reset.
 *
 * `disabled` is deliberately NOT pulled from the overlay: it is native state
 * (config.yml disabledProviders), and letting a stale SQLite row clear it would
 * put a provider the user disabled back into the chat picker.
 */
function applyStoredOverrides(registry: ProviderItem[], stored: ProviderItem[]): ProviderItem[] {
  if (stored.length === 0) return registry;
  const storedBySlug = new Map(stored.map((provider) => [provider.slug.trim().toLowerCase(), provider]));
  return registry.map((provider) => {
    const saved = storedBySlug.get(provider.slug.trim().toLowerCase());
    if (!saved) return provider;
    const savedModels = new Map(saved.models.map((model) => [model.id, model]));
    return {
      ...provider,
      models: provider.models.map((model) => {
        const previous = savedModels.get(model.id);
        if (!previous) return model;
        return {
          ...model,
          isVisible: previous.isVisible !== false,
          ...(previous.temperature !== undefined ? { temperature: previous.temperature } : {}),
          ...(previous.maxTokens !== undefined ? { maxTokens: previous.maxTokens } : {}),
          ...(previous.topP !== undefined ? { topP: previous.topP } : {}),
          ...(previous.reasoningEffort !== undefined ? { reasoningEffort: previous.reasoningEffort } : {}),
        };
      }),
    };
  });
}

/** Merge all three omp provider sources with app-local custom SQLite entries. */
export async function mergeProviders(custom: ProviderItem[]): Promise<{ providers: ProviderItem[]; modelsConfigPath: string }> {
  const disabled = await readDisabledProviders().catch(() => new Set<string>());
  const authItems = await loadRpcProviderItems();
  const native = await readNativeProviders();
  const nativeItems = native.map((info) => nativeProviderItem(info, disabled.has(info.slug)));
  const disabledItems = [...disabled]
    .filter((slug) => !nativeItems.some((n) => n.slug === slug) && !authItems.some((a) => a.slug === slug))
    .map(disabledProviderItem);
  const registryItems = applyStoredOverrides(
    deduplicateProviderItems([...authItems, ...nativeItems, ...disabledItems]),
    custom,
  );
  const nativeSlugs = new Set(registryItems.map((provider) => provider.slug.toLowerCase()));
  // `inModelsYml` is stamped from the FILE's own slug set, not from whichever
  // source supplied the entry. A provider can be described by the auth half or
  // by a stale overlay row while its models.yml entry is what a delete would
  // remove — deriving the flag from the supplying half left those entries with
  // no delete button even though the file held them.
  const modelsYmlSlugs = new Set(native.map((info) => info.slug.toLowerCase()));
  const providers = deduplicateProviderItems([
    ...registryItems,
    ...custom.filter((p) => !nativeSlugs.has(p.slug.toLowerCase())),
  ]).map((provider) => (
    modelsYmlSlugs.has(provider.slug.trim().toLowerCase())
      ? { ...provider, inModelsYml: true }
      : provider
  ));
  return {
    providers,
    modelsConfigPath: await getModelsConfigPath(),
  };
}
