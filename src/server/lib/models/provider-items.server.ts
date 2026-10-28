/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The ProviderItem shapes the registry builds from omp's own state rather than
 * from a Kabmo-side guess: a login provider omp knows, a `models.yml` entry,
 * and a provider omp reports as disabled in `config.yml`.
 *
 * Split from `provider-registry.server.ts` because these are the payload the
 * settings UI actually reads — a field dropped here is invisible until the
 * control it gates stops working, which is how a missing `baseUrl` disabled
 * "fetch models" for every models.yml provider without an error anywhere.
 *
 * Models come from the CLI catalog (`omp models --json --kind all`), not from
 * `get_available_models`: that RPC answers CHAT models only, so an embedding,
 * image, judge or rerank model could not be shown at all, and the row's own
 * `kind`, `thinking`, `input` and `cost` were dropped — every model read
 * `hasVision: false` / `hasTools: true` whatever omp actually knew.
 */

import {
  isOmpProviderApi,
  isProviderAuthMode,
  isProviderDiscoveryType,
} from '@/shared/lib/models/provider/dialect';
import { removeLegacyKenariModels } from '@/shared/lib/models/provider/cleanup';
import { formatContextWindow } from '@/shared/lib/code/format';
import type { NativeProviderInfo, NativeModelInfo } from '@/server/lib/omp/config/models-config';
import type { CatalogModel } from '@/server/lib/models/catalog.server';
import type { OmpLoginProvider } from '@/server/lib/omp/rpc/utility';
import type { ProviderCredentialOrigin, ProviderItem, ProviderModel } from '@/shared/types';

/** The per-model display state Kabmo owns (visibility + saved sampling knobs). */
export interface ModelOverlayEntry {
  isVisible: boolean;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  reasoningEffort?: ProviderModel['reasoningEffort'];
}

/** A provider's overlay rows, keyed by model id. */
export type ModelOverlay = Map<string, ModelOverlayEntry>;

/** One catalog row → the panel's model shape, with the user's overlay applied. */
export function catalogModelToProviderModel(model: CatalogModel, overlay?: ModelOverlay): ProviderModel {
  const saved = overlay?.get(model.id);
  const efforts = model.thinking?.efforts ?? [];
  return {
    id: model.id,
    name: model.name,
    contextWindow: contextLabel(model.contextWindow, model.maxTokens),
    hasTools: true,
    hasVision: model.input.includes('image'),
    ...(model.reasoning ? { hasReasoning: true } : {}),
    isVisible: saved ? saved.isVisible !== false : true,
    ...(model.kind && model.kind !== 'chat' ? { kind: model.kind } : {}),
    ...(efforts.length > 0 ? { thinkingEfforts: efforts } : {}),
    ...(model.thinking?.mode ? { thinkingMode: model.thinking.mode } : {}),
    ...(model.pricingStatus ? { pricingStatus: model.pricingStatus } : {}),
    ...(model.cost?.input !== undefined ? { priceInput: model.cost.input } : {}),
    ...(model.cost?.output !== undefined ? { priceOutput: model.cost.output } : {}),
    ...(model.cost?.cacheRead !== undefined ? { priceCacheRead: model.cost.cacheRead } : {}),
    ...(model.cost?.cacheWrite !== undefined ? { priceCacheWrite: model.cost.cacheWrite } : {}),
    ...(saved?.temperature !== undefined ? { temperature: saved.temperature } : {}),
    ...(saved?.maxTokens !== undefined ? { maxTokens: saved.maxTokens } : {}),
    ...(saved?.topP !== undefined ? { topP: saved.topP } : {}),
    ...(saved?.reasoningEffort !== undefined ? { reasoningEffort: saved.reasoningEffort } : {}),
  };
}

/** `1M ctx · 384K out` — the badge the model rows print. */
function contextLabel(contextWindow?: number, maxTokens?: number): string {
  const context = contextWindow ? formatContextWindow(contextWindow) : '';
  const out = maxTokens ? formatContextWindow(maxTokens) : '';
  if (context && out) return `${context} ctx · ${out} out`;
  if (context) return `${context} ctx`;
  return '';
}

/** A models.yml model entry → the panel's shape (catalog rows win when both exist). */
function nativeModelToProviderModel(model: NativeModelInfo, overlay?: ModelOverlay): ProviderModel {
  const saved = overlay?.get(model.id);
  return {
    id: model.id,
    name: model.name || model.id,
    contextWindow: contextLabel(model.contextWindow, model.maxTokens),
    hasTools: model.supportsTools !== false,
    hasVision: model.imageInput === true,
    ...(model.reasoning ? { hasReasoning: true } : {}),
    isVisible: saved ? saved.isVisible !== false : true,
    ...(model.kind && model.kind !== 'chat' ? { kind: model.kind } : {}),
    ...(model.thinkingEfforts && model.thinkingEfforts.length > 0
      ? { thinkingEfforts: model.thinkingEfforts }
      : {}),
    ...(model.thinkingMode ? { thinkingMode: model.thinkingMode } : {}),
    ...(model.cost?.input !== undefined ? { priceInput: model.cost.input } : {}),
    ...(model.cost?.output !== undefined ? { priceOutput: model.cost.output } : {}),
    ...(saved?.temperature !== undefined ? { temperature: saved.temperature } : {}),
    ...(saved?.maxTokens !== undefined ? { maxTokens: saved.maxTokens } : {}),
    ...(saved?.topP !== undefined ? { topP: saved.topP } : {}),
    ...(saved?.reasoningEffort !== undefined ? { reasoningEffort: saved.reasoningEffort } : {}),
  };
}

/**
 * A provider's models: every catalog row, then any `models.yml` id the catalog
 * does not serve (a model whose credential has lapsed, or one omp filters out
 * of the listing). The union is what makes the panel's count honest in both
 * directions — a catalog-only row was invisible before, and a registered id
 * missing from the listing looked deleted.
 */
export function providerModels(
  identity: Pick<ProviderItem, 'name' | 'slug' | 'baseUrl'>,
  catalog: CatalogModel[] | undefined,
  nativeModels: NativeModelInfo[] | undefined,
  overlay?: ModelOverlay,
): ProviderModel[] {
  const models = (catalog ?? []).map((model) => catalogModelToProviderModel(model, overlay));
  const seen = new Set(models.map((model) => model.id));
  for (const native of nativeModels ?? []) {
    if (seen.has(native.id)) continue;
    models.push(nativeModelToProviderModel(native, overlay));
    seen.add(native.id);
  }
  return removeLegacyKenariModels(identity, models);
}

/** Facts about the credential stores, shared by every provider row. */
export interface CredentialContext {
  originOf: (slug: string) => ProviderCredentialOrigin | undefined;
  /** Slugs that carry an `apiKey` in models.yml. */
  modelsYmlKeys: Set<string>;
}

/**
 * A provider omp knows from `get_login_providers`.
 *
 * Unauthenticated providers are included ON PURPOSE: omp's own `/models` hub
 * lists them (dimmed, under "Not signed in") and forwards a pick to `/login`.
 * Filtering them out — which this panel did — made an OAuth provider that had
 * never been signed in unreachable, with nothing on screen to say it existed.
 */
export function loginProviderItem(
  provider: OmpLoginProvider,
  options: {
    disabled: boolean;
    catalog?: CatalogModel[];
    nativeModels?: NativeModelInfo[];
    overlay?: ModelOverlay;
    credentials: CredentialContext;
  },
): ProviderItem {
  const origin = options.credentials.originOf(provider.id);
  const authenticated = provider.authenticated && !options.disabled;
  return {
    id: `omp-auth-${provider.id}`,
    name: provider.name,
    slug: provider.id,
    icon: provider.id,
    status: authenticated ? 'connected' : 'disconnected',
    disabled: options.disabled,
    configuredIn: origin === 'environment' ? 'environment' : 'omp auth credentials',
    credentialSource: 'omp-auth' as const,
    ...(origin ? { credentialOrigin: origin } : {}),
    oauth: true,
    available: provider.available,
    models: providerModels(
      { name: provider.name, slug: provider.id },
      options.catalog,
      options.nativeModels,
      options.overlay,
    ),
  };
}

/**
 * Native provider entry discovered from models.yml. Credentials never leave
 * omp's own stores — Kabmo only surfaces registration info.
 */
export function nativeProviderItem(
  info: NativeProviderInfo,
  isDisabled: boolean,
  catalog: CatalogModel[] | undefined,
  overlay: ModelOverlay | undefined,
  credentials: CredentialContext,
): ProviderItem {
  const { slug, baseUrl } = info;
  return {
    id: `omp-native-${slug}`,
    name: slug,
    slug,
    icon: slug,
    status: isDisabled ? 'disconnected' : 'connected',
    disabled: isDisabled,
    configuredIn: baseUrl ? `models.yml · ${baseUrl}` : 'models.yml',
    credentialSource: 'models.yml' as const,
    credentialOrigin: credentials.originOf(slug),
    available: true,
    // The endpoint travels on the item, not only inside `configuredIn`'s label.
    // It is what the models list gates "fetch models" on, so leaving it out of
    // the payload disabled the button for every models.yml provider — the one
    // set of providers whose endpoint is actually known to Kabmo. The URL is
    // not a secret: `configuredIn` already prints it.
    ...(baseUrl ? { baseUrl } : {}),
    // This entry was built FROM models.yml, so the file holds it by definition.
    inModelsYml: true,
    // The dialect is what makes a native entry legible in the settings UI: an
    // Anthropic-shaped proxy and an [OI] one look identical without it, and
    // the keyless/auth choice decides whether a missing credential is a bug.
    ...(isOmpProviderApi(info.api) ? { api: info.api } : {}),
    ...(isProviderAuthMode(info.auth) ? { auth: info.auth } : {}),
    ...(isProviderDiscoveryType(info.discovery) ? { discovery: info.discovery } : {}),
    ...(info.headers ? { headers: info.headers } : {}),
    ...(info.authHeader ? { authHeader: true } : {}),
    ...(info.transport ? { transport: info.transport } : {}),
    // The registry can tell the two shapes apart without guessing: a discovery
    // block means omp owns the list, and no models at all under a configured
    // endpoint means this is an override for a bundled provider.
    modelSource: isProviderDiscoveryType(info.discovery)
      ? 'discovery'
      : info.models.length === 0 && Boolean(baseUrl)
        ? 'override'
        : 'fetch',
    models: providerModels({ name: slug, slug, ...(baseUrl ? { baseUrl } : {}) }, catalog, info.models, overlay),
  };
}

/**
 * A provider that serves models but appears in neither `get_login_providers`
 * nor models.yml — a keyless local endpoint (ollama, LM Studio, llama.cpp) omp
 * discovers on its own. Without this row its models existed in the chat picker
 * and nowhere in the panel that is supposed to manage them.
 */
export function catalogProviderItem(
  slug: string,
  catalog: CatalogModel[],
  overlay: ModelOverlay | undefined,
): ProviderItem {
  return {
    id: `omp-catalog-${slug}`,
    name: slug,
    slug,
    icon: slug,
    status: 'connected',
    configuredIn: 'discovered by omp',
    available: true,
    models: providerModels({ name: slug, slug }, catalog, [], overlay),
  };
}

/**
 * Build a disabled-native ProviderItem for a provider the omp agent reports as
 * disabled (config.yml disabledProviders). The UI treats these as
 * "disconnected" — re-enabling via POST { enableProvider } flips config.yml.
 */
export function disabledProviderItem(slug: string): ProviderItem {
  return {
    id: `omp-disabled-${slug}`,
    name: slug,
    slug,
    icon: slug,
    status: 'disconnected',
    disabled: true,
    configuredIn: 'omp disabledProviders',
    models: [],
  };
}
