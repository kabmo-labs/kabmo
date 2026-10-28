/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Provider registry assembly for the provider settings. Folds the four omp
 * sources — auth login providers, models.yml registrations, config.yml
 * disabledProviders, and the CLI model catalog — with Kabmo's local SQLite
 * overlay into the ProviderItem list the settings UI renders. Server-only:
 * reads omp config files and drives the shared utility RPC process.
 *
 * Every provider omp KNOWS is listed, including one with no credential. omp's
 * own `/models` hub draws them the same way (dimmed, under "Not signed in",
 * with a pick forwarding to `/login`), and filtering them out made an OAuth
 * provider that had never been signed in unreachable from the panel that is
 * supposed to be able to sign it in.
 */

import { readDisabledProviders } from '@/server/lib/omp/config/disabled-providers';
import { getModelsConfigPath, readNativeProviders } from '@/server/lib/omp/config/models-config';
import { runUtilityCommand, type OmpLoginProvider, type OmpModel } from '@/server/lib/omp/rpc/utility';
import {
  catalogProviderItem,
  disabledProviderItem,
  loginProviderItem,
  nativeProviderItem,
  type CredentialContext,
  type ModelOverlay,
} from '@/server/lib/models/provider-items.server';
import { readModelCatalogByProvider, type CatalogByProvider } from '@/server/lib/models/catalog.server';
import {
  readAgentDbCredentialIndex,
  resolveCredentialOrigin,
  type AgentDbCredentialIndex,
} from '@/server/lib/models/credential-origin.server';
import { stampProviderIcons } from '@/server/lib/models/provider-icon.server';
import { removeLegacyKenariModels } from '@/shared/lib/models/provider/cleanup';
import type { ProviderItem, ProviderModel } from '@/shared/types';

/** app_settings key holding Kabmo-local provider overlay. */
export const PROVIDERS_SETTINGS_KEY = 'omp_providers_config';

const RPC_CACHE_TTL_MS = 60_000;

/** Minimal shape of a get_login_providers entry, as Kabmo reads it. */
export interface DetectedLoginProvider extends OmpLoginProvider {}

function isOmpModel(model: unknown): model is OmpModel {
  return (
    typeof model === 'object' && model !== null
    && typeof (model as OmpModel).id === 'string'
    && typeof (model as OmpModel).provider === 'string'
  );
}

function isDetectedLoginProvider(provider: unknown): provider is DetectedLoginProvider {
  return (
    typeof provider === 'object' && provider !== null
    && typeof (provider as { id?: unknown }).id === 'string'
    && typeof (provider as { name?: unknown }).name === 'string'
    && typeof (provider as { authenticated?: unknown }).authenticated === 'boolean'
  );
}

export interface OmpRegistrySnapshot {
  /** Login providers omp reports (authenticated or not). */
  providers: DetectedLoginProvider[];
  /**
   * Every CHAT model omp currently serves.
   *
   * Deliberately the RPC's own view, chat only: the two callers that read this
   * (`provider-key.ts`, the boot banner) ask a PROVIDER-level question — "does
   * this provider serve anything" — and one chat model answers it. The settings
   * panel's model list does NOT come from here: it needs every kind, so it
   * reads `omp models --json --kind all` (`catalog.server.ts`).
   */
  models: OmpModel[];
}

/**
 * Raw omp registry probe — the login providers omp knows and the chat models
 * they serve. Throws when the utility RPC is unreachable; each caller degrades
 * its own way.
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

/** Login providers from the shared RPC, cached for a minute. */
async function loadLoginProviders(): Promise<DetectedLoginProvider[]> {
  const cached = globalThis.__kabmoLoginProvidersCache;
  if (cached && cached.expiresAt > Date.now()) return cached.data as DetectedLoginProvider[];
  try {
    const { providers } = await fetchOmpRegistrySnapshot();
    globalThis.__kabmoLoginProvidersCache = { data: providers, expiresAt: Date.now() + RPC_CACHE_TTL_MS };
    return providers;
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
    // The origin is a fact about the credential STORE, so the half that knows
    // it wins over the half that does not.
    credentialOrigin: primary.credentialOrigin ?? secondary.credentialOrigin,
    oauth: primary.oauth === true || secondary.oauth === true,
    // A union, not a winner-takes-all: the two halves see different files
    // (auth sees login providers, native sees models.yml), and the flag decides
    // whether the delete button may appear at all.
    inModelsYml: primary.inModelsYml === true || secondary.inModelsYml === true,
    // Dialect fields come from whichever side knows them: the auth source
    // never carries them, the native models.yml source always does.
    api: primary.api ?? secondary.api,
    auth: primary.auth ?? secondary.auth,
    discovery: primary.discovery ?? secondary.discovery,
    headers: primary.headers ?? secondary.headers,
    authHeader: primary.authHeader ?? secondary.authHeader,
    transport: primary.transport ?? secondary.transport,
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
      inOverlay: true,
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

/** The overlay's per-model state for one provider, keyed by model id. */
function overlayFor(stored: ProviderItem[], slug: string): ModelOverlay | undefined {
  const saved = stored.find((provider) => provider.slug.trim().toLowerCase() === slug.trim().toLowerCase());
  if (!saved || saved.models.length === 0) return undefined;
  const overlay: ModelOverlay = new Map();
  for (const model of saved.models) {
    overlay.set(model.id, {
      isVisible: model.isVisible !== false,
      ...(model.temperature !== undefined ? { temperature: model.temperature } : {}),
      ...(model.maxTokens !== undefined ? { maxTokens: model.maxTokens } : {}),
      ...(model.topP !== undefined ? { topP: model.topP } : {}),
      ...(model.reasoningEffort !== undefined ? { reasoningEffort: model.reasoningEffort } : {}),
    });
  }
  return overlay;
}

function credentialContext(
  credentials: AgentDbCredentialIndex,
  modelsYmlKeys: Set<string>,
  authenticated: Set<string>,
): CredentialContext {
  return {
    modelsYmlKeys,
    originOf: (slug: string) => resolveCredentialOrigin({
      slug,
      authenticated: authenticated.has(slug.trim().toLowerCase()),
      inModelsYml: false,
      hasModelsYmlKey: modelsYmlKeys.has(slug.trim().toLowerCase()),
      credentials,
    }),
  };
}

/** Merge every omp provider source with app-local custom SQLite entries. */
export async function mergeProviders(custom: ProviderItem[]): Promise<{
  providers: ProviderItem[];
  modelsConfigPath: string;
  catalogError: string | null;
}> {
  const [disabled, loginProviders, native, catalog, credentials] = await Promise.all([
    readDisabledProviders().catch(() => new Set<string>()),
    loadLoginProviders(),
    readNativeProviders(),
    readModelCatalogByProvider(),
    readAgentDbCredentialIndex(),
  ]);
  const modelsYmlKeys = new Set(
    native.filter((info) => info.hasApiKey === true).map((info) => info.slug.trim().toLowerCase()),
  );
  const authenticated = new Set(
    loginProviders
      .filter((provider) => provider.authenticated)
      .map((provider) => provider.id.trim().toLowerCase()),
  );
  const ctx = credentialContext(credentials, modelsYmlKeys, authenticated);
  const catalogFor = (slug: string) => catalog.byProvider.get(slug.trim().toLowerCase());

  const authItems = loginProviders.map((provider) => loginProviderItem(provider, {
    disabled: disabled.has(provider.id),
    ...(catalogFor(provider.id) ? { catalog: catalogFor(provider.id) } : {}),
    nativeModels: native.find((info) => info.slug === provider.id)?.models,
    overlay: overlayFor(custom, provider.id),
    credentials: ctx,
  }));
  const nativeItems = native.map((info) => nativeProviderItem(
    info,
    disabled.has(info.slug),
    catalogFor(info.slug),
    overlayFor(custom, info.slug),
    ctx,
  ));
  const disabledItems = [...disabled]
    .filter((slug) => !nativeItems.some((n) => n.slug === slug) && !authItems.some((a) => a.slug === slug))
    .map(disabledProviderItem);
  // Providers that serve models but appear in neither source: a keyless local
  // endpoint omp discovers itself. Their models reach the chat picker, so the
  // panel that manages providers must list them too.
  const knownSlugs = new Set([
    ...loginProviders.map((provider) => provider.id.trim().toLowerCase()),
    ...native.map((info) => info.slug.trim().toLowerCase()),
  ]);
  const catalogOnly = [...catalog.byProvider.entries()]
    .filter(([slug]) => !knownSlugs.has(slug) && !disabled.has(slug))
    .map(([slug, models]) => catalogProviderItem(slug, models, overlayFor(custom, slug)));

  const registryItems = applyStoredOverrides(
    deduplicateProviderItems([...authItems, ...nativeItems, ...catalogOnly, ...disabledItems]),
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
  // A provider's own site is the only identity a `models.yml` endpoint has, so
  // its favicon replaces the initials fallback wherever one has been fetched.
  // `stampProviderIcons` reads stored stamps only and fetches in the background
  // — a provider list must never wait on a third-party host.
  const stamped = await stampProviderIcons(providers);
  return {
    providers: stamped,
    modelsConfigPath: await getModelsConfigPath(),
    catalogError: catalog.error,
  };
}

/** Every provider's models, for the model pickers that only need the list. */
export function flattenProviderModels(providers: ProviderItem[]): ProviderModel[] {
  return providers.flatMap((provider) => provider.models);
}

export type { CatalogByProvider };
