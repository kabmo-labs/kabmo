import { json } from '@/server/lib/remix-compat';
import type { ActionFunctionArgs } from '@/server/lib/remix-compat';
import { isMockMode } from '@/server/mock.server';
import { upsertOmpProviderModels } from '@/server/lib/omp/config/providers';
import { readOmpProviderApiKey } from '@/server/lib/omp/core/auth-credentials';
import { refreshModelRegistryAfterWrite } from '@/server/lib/models/registry-refresh.server';
import {
  enrichFromCatalog,
  fetchRemoteModels,
  toOmpSeed,
} from '@/server/lib/models/provider-listing.server';
import {
  inferProviderApi,
  isOmpProviderApi,
  isProviderAuthMode,
  isProviderDiscoveryType,
} from '@/shared/lib/models/provider/dialect';
import type { ProviderModel } from '@/shared/types';

/**
 * POST /api/settings/provider-models — lists models from a provider endpoint
 * for the providers settings auto-fetch, and optionally registers the provider
 * in omp's own models.yml. Body:
 * { baseUrl: string, apiKey?: string, providerSlug?: string, persistToOmp?: boolean,
 *   replaceModels?: boolean, api?: OmpProviderApi, auth?: ProviderAuthMode,
 *   discovery?: ProviderDiscoveryType, registerOnly?: boolean }
 *   → { ok, models, omp? } | { ok: false, error }.
 *
 * `replaceModels` makes the listing the provider's WHOLE model list: the
 * entries it still carries are refreshed and the ids it dropped are removed
 * from models.yml. It is what "fetch models" sends — an endpoint's `/models`
 * answer describes what it serves NOW, and an add-only merge left the panel
 * offering models that no longer exist. The add-provider path omits it, since
 * it is creating an entry rather than syncing one.
 *
 * `api` picks the dialect, which decides both the auth header the listing probe
 * sends and the `api` written to models.yml; when it is omitted the endpoint is
 * classified by URL and the probe tries the three common auth styles. Models
 * missing metadata (context, capabilities, price) are enriched from the
 * models.dev catalog. The probe itself lives in
 * `@/server/lib/models/provider-listing.server`.
 *
 * `discovery` and `registerOnly` skip the listing entirely: the first registers
 * a provider OMP will list itself, the second registers an endpoint override
 * for a provider omp already bundles. Both are legitimate with an empty model
 * list — writing ids there would freeze a snapshot omp would then serve
 * alongside its own listing.
 */

const MASKED_KEY_PATTERN = /•{3,}/;

const MOCK_REMOTE_MODELS: ProviderModel[] = [
  {
    id: 'mock-fetched-pro',
    name: 'Mock Ultra Pro (fetched)',
    contextWindow: '200K ctx · 64K out',
    hasTools: true,
    hasVision: true,
    hasReasoning: true,
    isVisible: true,
  },
  {
    id: 'mock-fetched-flash',
    name: 'Mock Flash (fetched)',
    contextWindow: '128K ctx · 16K out',
    hasTools: true,
    hasVision: false,
    isVisible: true,
  },
  {
    id: 'mock-fetched-mini',
    name: 'Mock Mini (fetched)',
    contextWindow: '64K ctx · 8K out',
    hasTools: true,
    hasVision: false,
    isVisible: true,
  },
];

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json({ ok: false, error: 'Method not allowed' }, { status: 405 });
  }
  try {
    const body = await request.json() as {
      baseUrl?: unknown;
      apiKey?: unknown;
      providerSlug?: unknown;
      persistToOmp?: unknown;
      api?: unknown;
      auth?: unknown;
      discovery?: unknown;
      registerOnly?: unknown;
      replaceModels?: unknown;
    };
    const baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : '';
    const rawApiKey = typeof body.apiKey === 'string' && body.apiKey.trim().length > 0 ? body.apiKey.trim() : undefined;
    // The UI echoes stored masked keys back; a masked value is not a credential.
    const apiKey = rawApiKey && !MASKED_KEY_PATTERN.test(rawApiKey) ? rawApiKey : undefined;
    const providerSlug = typeof body.providerSlug === 'string' && body.providerSlug.trim().length > 0
      ? body.providerSlug.trim()
      : undefined;
    const persistToOmp = body.persistToOmp === true;
    const registerOnly = body.registerOnly === true;
    // An unrecognized dialect from the client is dropped rather than written:
    // omp disables EVERY custom provider in the file over one unknown `api`.
    const api = isOmpProviderApi(body.api) ? body.api : undefined;
    const auth = isProviderAuthMode(body.auth) ? body.auth : undefined;
    const discovery = isProviderDiscoveryType(body.discovery) ? body.discovery : undefined;
    if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) {
      return json({ ok: false, error: 'Base URL must be a valid http(s) endpoint' }, { status: 400 });
    }
    // A keyless or discovery-only provider has no listing to fetch, so a
    // register-only call is the whole operation — and it must not demand the
    // model list that the caller deliberately did not ask for.
    const skipListing = registerOnly || discovery !== undefined;

    if (isMockMode()) {
      return json({ ok: true, models: skipListing ? [] : MOCK_REMOTE_MODELS });
    }

    // A provider whose credential lives in models.yml or agent.db never sends
    // it to the browser — the settings payload carries no key material — so the
    // probe resolves it here, server-side. Without this, "fetch models" on a
    // models.yml provider reached a keyed endpoint with no Authorization header
    // and every listing answered 401, which reads exactly like a broken
    // endpoint. The resolved key is used for the PROBE only: it is never passed
    // to the writer, so a credential is not copied from one of omp's stores into
    // another.
    const probeApiKey = apiKey ?? (providerSlug ? (await readOmpProviderApiKey(providerSlug)) ?? undefined : undefined);

    let enriched: ProviderModel[] = [];
    if (!skipListing) {
      const result = await fetchRemoteModels(baseUrl, probeApiKey, api);
      if (!result.models) {
        return json({ ok: false, error: result.error }, { status: 502 });
      }
      enriched = await enrichFromCatalog(result.models, providerSlug);
    }

    let omp: {
      written: boolean;
      addedCount: number;
      backfilledCount: number;
      removedCount: number;
      reason?: string;
    } | undefined;
    if (persistToOmp && providerSlug) {
      try {
        const upsert = await upsertOmpProviderModels(providerSlug, {
          baseUrl,
          apiKey,
          api: api ?? inferProviderApi(baseUrl),
          ...(auth ? { auth } : {}),
          ...(discovery ? { discovery } : {}),
          // An override/discovery provider keeps omp's own model list; writing
          // ids here would freeze a snapshot omp would then serve twice.
          overrideOnly: skipListing,
          // The endpoint's answer is the whole list: refresh the entries it
          // still carries and drop the ones it no longer serves.
          ...(body.replaceModels === true ? { replaceModels: true } : {}),
          models: enriched.map(toOmpSeed),
        });
        if (upsert.written) await refreshModelRegistryAfterWrite({ reprobe: true });
        omp = {
          written: upsert.written,
          addedCount: upsert.addedModels.length,
          backfilledCount: upsert.backfilledModels.length,
          removedCount: upsert.removedModels.length,
          reason: upsert.reason,
        };
      } catch (error) {
        omp = {
          written: false,
          addedCount: 0,
          backfilledCount: 0,
          removedCount: 0,
          reason: error instanceof Error ? error.message : 'models.yml write failed',
        };
      }
    }

    return json({ ok: true, models: enriched, omp });
  } catch (error: unknown) {
    return json({
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to fetch models',
    }, { status: 500 });
  }
}
