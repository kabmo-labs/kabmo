/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One vocabulary for wire protocols, and every registry's own spelling of it.
 *
 * Six registries name the same three protocols in six vocabularies — omp's
 * `api: openai-completions`, opencode's `npm: @ai-sdk/openai-compatible`, kimi's
 * `type: openai_legacy`, qwen's bucket key `openai`, codex's `wire_api: responses`
 * and Claude Code's mere existence as ANTHROPIC_BASE_URL. Passing one through to
 * the other writes a value the target rejects (measured: `wire_api = "chat"` now
 * makes codex refuse to load its whole config), so translation is a TABLE, not a
 * chain of `if`s at a call site.
 *
 * Canonical protocols are the HTTP shapes that actually exist:
 *
 *  - `openai-chat`      — POST /v1/chat/completions
 *  - `openai-responses` — POST /v1/responses
 *  - `anthropic-messages` — POST /v1/messages
 *  - `google-genai`     — GET /v1beta/models, POST :generateContent
 *  - `vertex-ai`        — google-genai over the Vertex access path
 *
 * Anything with no portable HTTP route (Bedrock's SigV4, Gemini CLI, the judge
 * APIs) is NOT a protocol here: it maps to null, which is what lets an import
 * refuse by name instead of writing a guess.
 *
 * Pure and dependency-free: the client uses it to label a row, the server to
 * pick a target's field value, and both must agree.
 */

import type { ProviderRegistryKind } from '@/shared/lib/harness/provider-facts';

export type CanonicalProtocol =
  | 'openai-chat'
  | 'openai-responses'
  | 'anthropic-messages'
  | 'google-genai'
  | 'vertex-ai';

/** Human label for a protocol, in the vendor's own vocabulary. */
export const PROTOCOL_LABELS: Readonly<Record<CanonicalProtocol, string>> = {
  'openai-chat': 'OpenAI Chat Completions',
  'openai-responses': 'OpenAI Responses',
  'anthropic-messages': 'Anthropic Messages',
  'google-genai': 'Google Gemini',
  'vertex-ai': 'Google Vertex AI',
};

/** Every protocol a registry may speak, in the order a probe should try them. */
export const CANONICAL_PROTOCOLS: readonly CanonicalProtocol[] = [
  'openai-chat',
  'openai-responses',
  'anthropic-messages',
  'google-genai',
  'vertex-ai',
];

/**
 * Source spelling → canonical protocol. Case and separator folded, because the
 * same value arrives as `openai-responses` (omp), `openai_responses` (kimi) and
 * `@ai-sdk/openai` (opencode) from three files.
 */
const SOURCE_DIALECTS: Readonly<Record<string, CanonicalProtocol>> = {
  // OpenAI Chat Completions, under every alias the registries use.
  'openai-completions': 'openai-chat',
  'openai-compatible': 'openai-chat',
  openaicompatible: 'openai-chat',
  openai: 'openai-chat',
  'openai-legacy': 'openai-chat',
  openailegacy: 'openai-chat',
  chat: 'openai-chat',
  'chat-completions': 'openai-chat',
  chatcompletions: 'openai-chat',
  'ai-sdk-openai-compatible': 'openai-chat',
  'opencode-ai-providers-openai-compatible': 'openai-chat',
  kimi: 'openai-chat',

  // OpenAI Responses.
  'openai-responses': 'openai-responses',
  'openai-codex-responses': 'openai-responses',
  'azure-openai-responses': 'openai-responses',
  responses: 'openai-responses',
  'ai-sdk-openai': 'openai-responses',
  'opencode-ai-providers-openai': 'openai-responses',

  // Anthropic Messages.
  'anthropic-messages': 'anthropic-messages',
  anthropic: 'anthropic-messages',
  'anthropic-compatible': 'anthropic-messages',
  'ai-sdk-anthropic': 'anthropic-messages',
  'opencode-ai-providers-anthropic': 'anthropic-messages',

  // Google.
  'google-generative-ai': 'google-genai',
  'google-genai': 'google-genai',
  gemini: 'google-genai',
  'ai-sdk-google': 'google-genai',
  'opencode-ai-providers-google': 'google-genai',
  'google-vertex': 'vertex-ai',
  vertexai: 'vertex-ai',
  'vertex-ai': 'vertex-ai',
  'opencode-ai-providers-google-vertex': 'vertex-ai',
};

/** A dialect spelling, folded to lowercase alphanumerics and single dashes. */
function foldDialect(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The canonical protocol a registry's own dialect value means, or null. */
export function protocolOfSourceDialect(value: string | undefined | null): CanonicalProtocol | null {
  if (!value) return null;
  return SOURCE_DIALECTS[foldDialect(value)] ?? null;
}

/**
 * The value each registry writes for a canonical protocol, or null when that
 * registry has no way to speak it.
 *
 * `openai-responses` maps to `@ai-sdk/openai` on opencode because that package
 * is the AI SDK's OpenAI provider, whose transport is selected by the endpoint;
 * `openai-chat` maps to `openai-compatible` there because a gateway is not
 * OpenAI's own host.
 */
export function dialectFor(kind: ProviderRegistryKind, protocol: CanonicalProtocol): string | null {
  switch (kind) {
    case 'yaml-providers':
    case 'json-providers':
      return {
        'openai-chat': 'openai-completions',
        'openai-responses': 'openai-responses',
        'anthropic-messages': 'anthropic-messages',
        'google-genai': 'google-generative-ai',
        'vertex-ai': 'google-vertex',
      }[protocol];
    case 'json-provider':
      return {
        'openai-chat': '@ai-sdk/openai-compatible',
        'openai-responses': '@ai-sdk/openai',
        'anthropic-messages': '@ai-sdk/anthropic',
        'google-genai': '@ai-sdk/google',
        'vertex-ai': '@ai-sdk/google',
      }[protocol];
    case 'toml-model-providers':
      // codex speaks exactly one wire format now; `chat` is rejected at config
      // load, and a single such entry makes every codex command fail.
      return protocol === 'openai-responses' ? 'responses' : null;
    case 'toml-providers':
      return {
        'openai-chat': 'openai',
        'openai-responses': 'openai_responses',
        'anthropic-messages': 'anthropic',
        'google-genai': 'google-genai',
        'vertex-ai': 'vertexai',
      }[protocol];
    case 'json-model-providers':
      // qwen routes by protocol BUCKET; the bucket is the built-in id, so no
      // `providerProtocol` mapping is needed for these five.
      return {
        'openai-chat': 'openai',
        'openai-responses': 'openai',
        'anthropic-messages': 'anthropic',
        'google-genai': 'gemini',
        'vertex-ai': 'vertex-ai',
      }[protocol];
    default:
      return null;
  }
}

/** Every protocol a registry CAN express, in probe order. */
export function protocolsFor(kind: ProviderRegistryKind): readonly CanonicalProtocol[] {
  return CANONICAL_PROTOCOLS.filter((protocol) => dialectFor(kind, protocol) !== null);
}

/**
 * qwen's OpenAI bucket carries the wire choice per ROW, not per bucket: the same
 * `openai` array holds Chat Completions and Responses routes.
 */
export function wireApiFor(protocol: CanonicalProtocol): string | null {
  if (protocol === 'openai-chat') return 'chat-completions';
  if (protocol === 'openai-responses') return 'responses';
  return null;
}

/**
 * How a target wants its endpoint spelled.
 *
 * `api-base` takes the full base (`https://kenari.id/v1`) because the registry's
 * own client appends only the route (`/chat/completions`). `root` takes the HOST
 * ROOT because the vendor SDK appends the version too — measured: Claude Code
 * with `ANTHROPIC_BASE_URL=https://kenari.id/v1` answered "successfully" with
 * `output_tokens: 0`, because it requested `/v1/v1/messages`.
 */
export type BaseUrlStyle = 'api-base' | 'root';

/** Strip the version segment a `root` target appends for itself. */
export function adaptBaseUrl(baseUrl: string, style: BaseUrlStyle): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (!trimmed || style === 'api-base') return trimmed;
  return trimmed.replace(/\/v1(beta|alpha)?$/i, '');
}

/**
 * Protocols a harness can carry, given its registry kind and (for an
 * `environment` harness) the single protocol its vendor SDK speaks.
 */
export function supportedProtocols(
  kind: ProviderRegistryKind,
  envProtocol?: CanonicalProtocol | null,
): readonly CanonicalProtocol[] {
  if (kind === 'env') return envProtocol ? [envProtocol] : [];
  return protocolsFor(kind);
}

/**
 * The protocol an import should use: the source's own when the target speaks it,
 * otherwise the first one both have. Null means the two cannot meet.
 */
export function planProtocol(
  sourceProtocol: CanonicalProtocol | null,
  target: readonly CanonicalProtocol[],
): CanonicalProtocol | null {
  if (target.length === 0) return null;
  if (sourceProtocol && target.includes(sourceProtocol)) return sourceProtocol;
  // No source dialect (a registry that declares none) still imports if exactly
  // one target protocol is possible, because then there is nothing to choose.
  if (!sourceProtocol) return target.length === 1 ? target[0] : null;
  return null;
}
