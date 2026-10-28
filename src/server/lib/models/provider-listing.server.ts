/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The model-listing probe behind the providers settings auto-fetch.
 *
 * A provider endpoint can be asked for its models in a handful of shapes, and
 * which one it answers depends on the WIRE DIALECT it speaks: an
 * Anthropic-shaped proxy rejects a Bearer header, a Gemini endpoint wants the
 * key in the query string, and a dialect with no listing route at all (Bedrock,
 * Vertex, Codex, the judge APIs) answers nothing. The probe therefore follows
 * the dialect when the caller knows it, and only falls back to trying the three
 * common styles when the endpoint is unclassified.
 *
 * Server-only: it performs the outbound HTTP the settings page must not.
 */

import { extractModels } from '@/shared/lib/models/remote-list';
import { findCatalogModel, loadModelsDevCatalog } from '@/shared/lib/models/catalog';
import type { OmpProviderApi } from '@/shared/types/settings/provider';
import type { ProviderModel } from '@/shared/types';

const FETCH_TIMEOUT_MS = 15_000;
const ANTHROPIC_VERSION = '2023-06-01';
/** omp's own Azure default (`DEFAULT_AZURE_API_VERSION` in pi-ai). */
const AZURE_API_VERSION = 'v1';

export interface FetchAttempt {
  models: ProviderModel[] | null;
  error: string;
}

async function attemptStyle(
  label: string,
  url: string,
  headers: Record<string, string>,
): Promise<FetchAttempt> {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // Non-JSON body (HTML error page, empty body) — payload stays null and is
    // reported below as an unrecognized response format.
  }
  if (response.status < 200 || response.status >= 300) {
    return { models: null, error: `${label}: HTTP ${response.status}` };
  }
  const models = extractModels(payload);
  if (!models) return { models: null, error: `${label}: unrecognized response format` };
  return { models, error: '' };
}

/**
 * Listing probe for one dialect, or `null` when the dialect has no listing
 * route to probe at all. Bedrock, Vertex, Codex, Gemini-CLI and the two judge
 * APIs are reached through non-`/models` protocols (SigV4, gcloud auth,
 * ChatGPT's backend, `{baseUrl}/decisions`), so probing `/models` there would
 * report a 404 as if the endpoint were broken. Those providers are registered
 * with an empty list instead.
 */
function listingAttempts(
  base: string,
  apiKey: string | undefined,
  api: OmpProviderApi,
): Array<{ label: string; url: string; headers: Record<string, string> }> | null {
  switch (api) {
    case 'anthropic-messages':
      return [{
        label: 'Anthropic',
        url: `${base}/models`,
        headers: { 'anthropic-version': ANTHROPIC_VERSION, ...(apiKey ? { 'x-api-key': apiKey } : {}) },
      }];
    case 'google-generative-ai':
      return [{
        label: 'Gemini',
        url: apiKey ? `${base}/models?key=${encodeURIComponent(apiKey)}` : `${base}/models`,
        headers: {},
      }];
    case 'openai-completions':
    case 'openai-responses':
      return [{
        label: 'OpenAI-compatible',
        url: `${base}/models`,
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      }];
    case 'azure-openai-responses':
      // Azure never takes a bearer: a string key is an `api-key` header, and
      // the api version rides as a query parameter (omp's own Azure client
      // builds the request the same way). A Bearer probe there answers 401 and
      // reads as a bad key.
      return [{
        label: 'Azure OpenAI',
        url: `${base}/models?api-version=${AZURE_API_VERSION}`,
        headers: apiKey ? { 'api-key': apiKey } : {},
      }];
    default:
      return null;
  }
}

/**
 * Try the styles a DIALECT implies, in order. An explicit dialect from the
 * request is authoritative — probing an Anthropic endpoint with a Bearer header
 * would fail with a 401 that reads like a bad key. With no dialect the endpoint
 * is unclassified, so the three styles are tried and the first recognizable
 * list wins, which is what makes the picker work for a gateway nobody named.
 *
 * A dialect with no listing route yields an empty list and no error: the
 * provider is still registered, it just cannot be enumerated from here.
 */
export async function fetchRemoteModels(
  baseUrl: string,
  apiKey: string | undefined,
  api: OmpProviderApi | undefined,
): Promise<FetchAttempt> {
  const base = baseUrl.replace(/\/+$/, '');
  const attempts: Array<{ label: string; url: string; headers: Record<string, string> }> = [];
  if (api) {
    const dialectAttempts = listingAttempts(base, apiKey, api);
    if (!dialectAttempts) return { models: [], error: '' };
    attempts.push(...dialectAttempts);
  } else {
    attempts.push({
      label: 'OpenAI-compatible',
      url: `${base}/models`,
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    });
    if (apiKey) {
      attempts.push({
        label: 'Anthropic',
        url: `${base}/models`,
        headers: { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION },
      });
      attempts.push({
        label: 'Gemini',
        url: `${base}/models?key=${encodeURIComponent(apiKey)}`,
        headers: {},
      });
    }
  }

  const errors: string[] = [];
  for (const attempt of attempts) {
    try {
      const result = await attemptStyle(attempt.label, attempt.url, attempt.headers);
      if (result.models) return result;
      errors.push(result.error);
    } catch (error) {
      // Network-level failure (DNS, refused, timeout) applies to every auth
      // style — no point retrying the same host with different headers.
      const message = error instanceof Error ? error.message : 'request failed';
      errors.push(`${attempt.label}: ${message}`);
      break;
    }
  }
  return {
    models: null,
    error: errors.length > 0 ? `Failed to fetch models — ${errors.join(' · ')}` : 'Failed to fetch models',
  };
}

/**
 * Derive a human-readable display name from a model id.
 *
 * - `deepseek-v4-flash-0731:netra` → `Deepseek-V4-Flash-0731 - Netra`
 * - `deepseek-v4-flash-0731` → `Deepseek-V4-Flash-0731` (title case)
 */
function displayNameFromId(modelId: string): string {
  const colonIdx = modelId.indexOf(':');
  if (colonIdx >= 0) {
    const suffix = modelId.slice(colonIdx + 1);
    if (suffix.length > 0) {
      const base = modelId.slice(0, colonIdx);
      const namePart = base.includes('/') ? base.split('/').pop()! : base;
      const titleBase = namePart.split('-').map(seg => seg.charAt(0).toUpperCase() + seg.slice(1)).join('-');
      const capSuffix = suffix.charAt(0).toUpperCase() + suffix.slice(1);
      return `${titleBase} - ${capSuffix}`;
    }
  }
  const name = modelId.includes('/') ? modelId.split('/').pop()! : modelId;
  return name.split('-').map(seg => seg.charAt(0).toUpperCase() + seg.slice(1)).join('-');
}

/**
 * Fill in metadata the listing endpoint did not provide from the models.dev
 * catalog: vision/reasoning/tool flags, context + output window, and
 * per-1M-token pricing (cache rates included). Only empty fields are filled —
 * anything the provider reported itself is kept.
 */
export async function enrichFromCatalog(
  models: ProviderModel[],
  providerSlug: string | undefined,
): Promise<ProviderModel[]> {
  const catalog = await loadModelsDevCatalog();
  if (!catalog || Object.keys(catalog).length === 0) return models;
  return models.map((model) => {
    const match = findCatalogModel(catalog, providerSlug, model.id);
    if (!match) return model;
    const { info } = match;
    const ctx = info.limit?.context;
    const out = info.limit?.output;
    const ctxLabel = !model.contextWindow && ctx && ctx > 0
      ? Math.round(ctx / 1000)
      : null;
    const outLabel = out && out > 0 ? Math.round(out / 1000) : null;
    const catalogContext = ctxLabel
      ? (outLabel ? `${ctxLabel}K ctx · ${outLabel}K out` : `${ctxLabel}K ctx`)
      : '';
    return {
      ...model,
      name: displayNameFromId(model.id),
      contextWindow: model.contextWindow || catalogContext,
      hasVision: model.hasVision || info.attachment === true,
      hasReasoning: model.hasReasoning ?? (info.reasoning === true || undefined),
      hasTools: model.hasTools || info.tool_call === true,
      priceInput: model.priceInput ?? (typeof info.cost?.input === 'number' ? info.cost.input : undefined),
      priceOutput: model.priceOutput ?? (typeof info.cost?.output === 'number' ? info.cost.output : undefined),
      priceCacheRead: model.priceCacheRead
        ?? (typeof info.cost?.cache_read === 'number' ? info.cost.cache_read : undefined),
      priceCacheWrite: model.priceCacheWrite
        ?? (typeof info.cost?.cache_write === 'number' ? info.cost.cache_write : undefined),
    };
  });
}

/**
 * omp's models.yml schema requires all four cost fields when cost is present,
 * so a price is only seeded when both sides are known; missing ones default
 * to 0. Context/output labels ("128K ctx · 16K out") parse back to tokens.
 * Cache prices come from the catalog and are kept when known — dropping them
 * makes every cached turn look free in omp's usage accounting.
 */
export function toOmpSeed(model: ProviderModel): {
  id: string;
  name?: string;
  reasoning?: boolean;
  imageInput?: boolean;
  contextWindow?: number;
  maxTokens?: number;
  cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
} {
  const parseTokens = (label: string, suffix: string): number | undefined => {
    const match = label.match(new RegExp(`(\\d+(?:\\.\\d+)?)([KM])? ${suffix}`));
    if (!match) return undefined;
    const value = Number.parseFloat(match[1]);
    if (!Number.isFinite(value) || value <= 0) return undefined;
    const multiplier = match[2] === 'M' ? 1_000_000 : 1000;
    return Math.round(value * multiplier);
  };
  const contextWindow = parseTokens(model.contextWindow, 'ctx');
  const outTokens = parseTokens(model.contextWindow, 'out');
  // omp rejects the whole file on a non-finite number, so a price has to be a
  // real finite value before it may be written at all.
  const price = (value: unknown): number | undefined => (
    typeof value === 'number' && Number.isFinite(value) ? value : undefined
  );
  const priceInput = price(model.priceInput);
  const priceOutput = price(model.priceOutput);
  const hasCost = priceInput !== undefined && priceOutput !== undefined;
  return {
    id: model.id,
    ...(model.name && model.name !== model.id ? { name: model.name } : {}),
    ...(model.hasReasoning ? { reasoning: true } : {}),
    ...(model.hasVision ? { imageInput: true } : {}),
    ...(contextWindow ? { contextWindow } : {}),
    ...(outTokens && outTokens > 0 ? { maxTokens: Math.round(outTokens) } : {}),
    ...(hasCost ? {
      cost: {
        input: priceInput,
        output: priceOutput,
        cacheRead: price(model.priceCacheRead) ?? 0,
        cacheWrite: price(model.priceCacheWrite) ?? 0,
      },
    } : {}),
  };
}
