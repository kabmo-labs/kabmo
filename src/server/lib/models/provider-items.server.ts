/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The two ProviderItem shapes the registry builds from omp's own config files
 * rather than from a live RPC probe: a models.yml entry, and a provider omp
 * reports as disabled in config.yml.
 *
 * Split from `provider-registry.server.ts` because these are the payload the
 * settings UI actually reads — a field dropped here is invisible until the
 * control it gates stops working, which is how a missing `baseUrl` disabled
 * "fetch models" for every models.yml provider without an error anywhere.
 */

import {
  isOmpProviderApi,
  isProviderAuthMode,
  isProviderDiscoveryType,
} from '@/shared/lib/models/provider/dialect';
import { removeLegacyKenariModels } from '@/shared/lib/models/provider/cleanup';
import { formatContextWindow } from '@/shared/lib/code/format';
import type { NativeProviderInfo } from '@/server/lib/omp/config/models-config';
import type { ProviderItem } from '@/shared/types';

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

/**
 * Native provider entry discovered from models.yml. Credentials never leave
 * omp's own stores — Kabmo only surfaces registration info.
 */
export function nativeProviderItem(info: NativeProviderInfo, isDisabled = false): ProviderItem {
  const { slug, baseUrl } = info;
  const models = info.models.map((model) => ({
    id: model.id,
    name: model.name || model.id,
    contextWindow: model.contextWindow
      ? `${formatContextWindow(model.contextWindow) || Math.round(model.contextWindow / 1000)} ctx`
      : '',
    hasTools: true,
    hasVision: model.imageInput === true,
    hasReasoning: model.reasoning,
    isVisible: true,
    maxTokens: model.maxTokens,
  }));
  return {
    id: `omp-native-${slug}`,
    name: slug,
    slug,
    icon: slug,
    status: isDisabled ? 'disconnected' : 'connected',
    disabled: isDisabled,
    configuredIn: baseUrl ? `models.yml · ${baseUrl}` : 'models.yml',
    credentialSource: 'models.yml' as const,
    // The endpoint travels on the item, not only inside `configuredIn`'s label.
    // It is what the models list gates "fetch models" on, so leaving it out of
    // the payload disabled the button for every models.yml provider — the one
    // set of providers whose endpoint is actually known to Kabmo. The
    // URL is not a secret: `configuredIn` already prints it.
    ...(baseUrl ? { baseUrl } : {}),
    // This entry was built FROM models.yml, so the file holds it by definition.
    inModelsYml: true,
    // The dialect is what makes a native entry legible in the settings UI: an
    // Anthropic-shaped proxy and an OpenAI one look identical without it, and
    // the keyless/auth choice decides whether a missing credential is a bug.
    ...(isOmpProviderApi(info.api) ? { api: info.api } : {}),
    ...(isProviderAuthMode(info.auth) ? { auth: info.auth } : {}),
    ...(isProviderDiscoveryType(info.discovery) ? { discovery: info.discovery } : {}),
    // The registry can tell the two shapes apart without guessing: a
    // discovery block means omp owns the list, and no models at all under a
    // configured endpoint means this is an override for a bundled provider.
    modelSource: isProviderDiscoveryType(info.discovery)
      ? 'discovery'
      : info.models.length === 0 && Boolean(baseUrl)
        ? 'override'
        : 'fetch',
    models: removeLegacyKenariModels({ name: slug, slug, baseUrl }, models),
  };
}
