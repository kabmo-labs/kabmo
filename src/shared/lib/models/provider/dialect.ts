/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The provider DIALECT — which wire API a custom provider speaks, how it
 * authenticates, and how its model list is obtained. All three are omp
 * `models.yml` provider fields, and all three change what a provider can do:
 *
 * - `api` selects the request/response shape. A gateway that speaks
 *   `anthropic-messages` is not reachable through the OpenAI-compatible path,
 *   and omp rejects an unknown `api` by disabling EVERY custom provider in the
 *   file — so the value must come from omp's own `ApiSchema`.
 * - `auth: none` is what makes a local server keyless; without it omp demands
 *   an `apiKey` and a keyless provider is rejected as unconfigured.
 * - `discovery` lets OMP list the models live from the endpoint instead of the
 *   Kabmo writing a snapshot of ids into `models.yml`.
 *
 * Pure data + pure functions, shared by the server (which validates and writes
 * the file) and the client (which offers the choices), so the two cannot
 * disagree about what omp accepts.
 */

import type { OmpProviderApi, ProviderAuthMode, ProviderDiscoveryType, ProviderModelSource } from '@/shared/types/settings/provider';

/** Every `api` omp accepts, in omp's own `ApiSchema` order. */
export const PROVIDER_APIS: readonly OmpProviderApi[] = [
  'openai-completions',
  'openai-responses',
  'openai-codex-responses',
  'azure-openai-responses',
  'anthropic-messages',
  'bedrock-converse-stream',
  'google-generative-ai',
  'google-gemini-cli',
  'google-vertex',
  'openrouter-decisions',
  'openai-decisions',
  'workers-ai-systemone',
  'typesafe',
];

/** One-line explanation of what each dialect is, for the picker. */
export const PROVIDER_API_LABELS: Readonly<Record<OmpProviderApi, string>> = {
  'openai-completions': '[OI] Chat Completions — the default for gateways and local servers',
  'openai-responses': '[OI] Responses API — newer [OI]-shaped endpoints',
  'openai-codex-responses': '[OC] Responses — Codex-style endpoints',
  'azure-openai-responses': 'Azure [OI] Responses — api-key header, api-version query',
  'anthropic-messages': 'Anthropic Messages — Claude-shaped proxies (x-api-key)',
  'bedrock-converse-stream': 'Amazon Bedrock Converse — AWS credential chain',
  'google-generative-ai': 'Google Generative AI — Gemini API (x-goog-api-key)',
  'google-gemini-cli': 'Google Gemini CLI — OAuth-backed Gemini route',
  'google-vertex': 'Google Vertex AI — service-account / ADC route',
  'openrouter-decisions': 'OpenRouter decisions — judge role only',
  'openai-decisions': '[OI] decisions — judge role only',
  'workers-ai-systemone': 'Workers AI System One — judge role only',
  typesafe: 'Typesafe System One — judge role only',
};

/**
 * omp's `EffortSchema` — the reasoning ladder, lowest first, in omp's own
 * `EFFORT_ORDER`.
 *
 * `off` is deliberately absent: omp rejects it inside `thinking.efforts`
 * ("must be minimal, low, medium, high, xhigh or max"), because turning thinking
 * off is a per-turn choice rather than a declared capability. A model that
 * declares no effort ladder at all still gets omp's default one.
 */
export const PROVIDER_THINKING_EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

export type ProviderThinkingEffort = (typeof PROVIDER_THINKING_EFFORTS)[number];

/** True when `value` is an effort omp's `EffortSchema` accepts. */
export function isProviderThinkingEffort(value: unknown): value is ProviderThinkingEffort {
  return typeof value === 'string' && (PROVIDER_THINKING_EFFORTS as readonly string[]).includes(value);
}

/** Auth modes omp accepts, with the meaning the picker shows. */
export const PROVIDER_AUTH_MODES: ReadonlyArray<{
  value: ProviderAuthMode;
  label: string;
  hint: string;
}> = [
  { value: 'apiKey', label: 'API key', hint: 'omp requires a key for this provider' },
  { value: 'none', label: 'No auth (keyless)', hint: 'Local server that needs no credential' },
  { value: 'oauth', label: 'OAuth', hint: 'Claude-Code-style proxy expecting the cloaked request shape' },
];

/**
 * omp's `ThinkingControlModeSchema` — how a model's effort selector is carried
 * on the wire. A `thinking` block without a mode is a schema failure that takes
 * every custom provider down with it, so the writer always states one.
 */
export const PROVIDER_THINKING_MODES = [
  'effort',
  'budget',
  'google-level',
  'anthropic-adaptive',
  'anthropic-budget-effort',
] as const;

export type ProviderThinkingMode = (typeof PROVIDER_THINKING_MODES)[number];

/** True when `value` is a thinking mode omp accepts. */
export function isProviderThinkingMode(value: unknown): value is ProviderThinkingMode {
  return typeof value === 'string' && (PROVIDER_THINKING_MODES as readonly string[]).includes(value);
}

/**
 * omp's `MODEL_KINDS`, in omp's own order, with the label the model list's
 * kind tabs show.
 *
 * A provider routinely serves more than chat: an embedding model, an image
 * model, a reranker. The RPC's `get_available_models` answers CHAT ONLY
 * (`modelRegistry.getAvailable()` defaults to kind `chat`), which is why the
 * panel used to be unable to show them at all — the listing has to come from
 * `omp models --json --kind all`, the same source the role dropdowns read.
 */
export const MODEL_KINDS = [
  'chat',
  'tiny',
  'image',
  'tts',
  'stt',
  'search',
  'judge',
  'embedding',
  'rerank',
  'video',
] as const;

export type ProviderModelKind = (typeof MODEL_KINDS)[number];

/** Labels for the kind tabs. Absent means chat — omp's own default. */
export const MODEL_KIND_LABELS: Readonly<Record<ProviderModelKind, string>> = {
  chat: 'Chat',
  tiny: 'Tiny',
  image: 'Image',
  tts: 'Speech',
  stt: 'Transcribe',
  search: 'Search',
  judge: 'Judge',
  embedding: 'Embedding',
  rerank: 'Rerank',
  video: 'Video',
};

/** The kind a row belongs to, folded to omp's default when it declares none. */
export function modelKindOf(value: unknown): ProviderModelKind {
  return typeof value === 'string' && (MODEL_KINDS as readonly string[]).includes(value)
    ? (value as ProviderModelKind)
    : 'chat';
}

/** Discovery types omp can drive itself, with what each one probes. */
export const PROVIDER_DISCOVERY_TYPES: ReadonlyArray<{
  value: ProviderDiscoveryType;
  label: string;
  hint: string;
}> = [
  { value: 'openai-models-list', label: 'OpenAI /v1/models', hint: 'Any OpenAI-compatible endpoint' },
  { value: 'ollama', label: 'Ollama', hint: 'Native Ollama /api/tags + /api/show' },
  { value: 'llama.cpp', label: 'llama.cpp', hint: 'llama.cpp server model endpoints' },
  { value: 'lm-studio', label: 'LM Studio', hint: 'LM Studio /v1/models + native metadata' },
  { value: 'litellm', label: 'LiteLLM proxy', hint: 'LiteLLM proxy with rich model metadata' },
  { value: 'proxy', label: 'New-API / One-API proxy', hint: 'Wire api read per model from the proxy' },
  {
    value: 'apple-foundation-models',
    label: 'Apple Foundation Models',
    hint: 'On-device model (Apple silicon only)',
  },
];

/** True when `value` is a dialect omp's `ApiSchema` accepts. */
export function isOmpProviderApi(value: unknown): value is OmpProviderApi {
  return typeof value === 'string' && (PROVIDER_APIS as readonly string[]).includes(value);
}

/**
 * True when the value is a credential the UI masked rather than a real key.
 *
 * The settings UI echoes a stored key back as `sk-••••…`; that placeholder must
 * never be persisted, or a provider looks configured while it cannot
 * authenticate. Shared by the client (which produces the mask) and the server
 * (which is the last gate before the file).
 */
export function isMaskedApiKey(value: unknown): boolean {
  return typeof value === 'string' && /•{3,}/.test(value);
}

/** True when `value` is an auth mode omp accepts. */
export function isProviderAuthMode(value: unknown): value is ProviderAuthMode {
  return value === 'apiKey' || value === 'none' || value === 'oauth';
}

/** True when `value` is a discovery type omp accepts. */
export function isProviderDiscoveryType(value: unknown): value is ProviderDiscoveryType {
  return PROVIDER_DISCOVERY_TYPES.some((entry) => entry.value === value);
}

/**
 * omp's `api` for a provider whose endpoint is only recognizable by URL. omp
 * accepts eleven dialects and no endpoint can be asked which one it speaks, so
 * only the two hosts that are unambiguous by name are claimed here; everything
 * else gets the OpenAI-compatible default that the model-listing probe already
 * assumes. Anything else (Azure, Bedrock, Vertex, a Codex proxy) has to be
 * picked by hand — guessing would write a dialect that misroutes every request.
 */
export function inferProviderApi(baseUrl: string): OmpProviderApi {
  if (/anthropic\./i.test(baseUrl)) return 'anthropic-messages';
  if (/generativelanguage\.googleapis\.com/i.test(baseUrl)) return 'google-generative-ai';
  if (/openai\.azure\.com/i.test(baseUrl)) return 'azure-openai-responses';
  if (/openrouter\.ai/i.test(baseUrl)) return 'openai-completions';
  return 'openai-completions';
}

/**
 * Why a provider's model list is empty — or `undefined` when the emptiness is
 * unexplained and should read as a problem.
 *
 * A provider with no models is not automatically broken: an endpoint override
 * leaves the model list to omp's own catalog, a discovery provider is listed by
 * omp at runtime, and an authenticated login provider's models arrive with the
 * agent's own snapshot. Printing "no models" for all of them made a correctly
 * configured proxy look like a failed setup.
 */
export function providerEmptyReason(provider: {
  modelSource?: ProviderModelSource;
  discovery?: ProviderDiscoveryType;
  auth?: ProviderAuthMode;
}): string | undefined {
  if (provider.discovery || provider.modelSource === 'discovery') {
    return 'omp discovers this provider’s models live — they appear in the chat model picker, not here.';
  }
  if (provider.modelSource === 'override') {
    // An override entry with no models and no credential is the one shape that
    // genuinely cannot serve anything: omp has no key to reach the endpoint
    // with. Naming the credential is the honest instruction.
    return provider.auth === 'none'
      ? 'Endpoint override — omp keeps its own model list for this provider. Use “fetch models” to add specific ids.'
      : 'Endpoint override — omp keeps its own model list for this provider. It still needs a credential: use “connect” to supply one, or “fetch models” to add specific ids.';
  }
  if (provider.auth === 'none') {
    return 'No models registered yet. This server is keyless, so use “fetch models” to list what it serves.';
  }
  return undefined;
}

/**
 * Why "fetch models" cannot run for this provider, or `undefined` when it can.
 *
 * One function for both the button's `disabled` state and its tooltip, because
 * a disabled button that only says "no fetchable endpoint" names the wrong cause
 * for half the cases. Two conditions block a fetch:
 *
 *  - no KNOWN endpoint — the probe needs somewhere to send the listing request,
 *    and a login provider (`omp auth`) carries no baseUrl because omp owns its
 *    endpoint;
 *  - the provider is listed by OMP ITSELF — a discovery entry resolves its
 *    models live on every run, so writing a fetched snapshot into models.yml
 *    would freeze one listing beside the live one omp keeps serving, which is
 *    the shape the writer's `overrideOnly` exists to avoid.
 */
export function providerFetchBlockReason(provider: {
  baseUrl?: string;
  discovery?: ProviderDiscoveryType;
  modelSource?: ProviderModelSource;
}): string | undefined {
  if (provider.discovery !== undefined || provider.modelSource === 'discovery') {
    return 'omp lists this provider’s models itself — importing would freeze a snapshot beside that live list. Use “refresh”.';
  }
  if (!provider.baseUrl) {
    return 'This provider has no endpoint Kabmo can probe — omp owns its URL. Use “refresh” instead.';
  }
  return undefined;
}

