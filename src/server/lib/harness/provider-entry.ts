/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What a provider ENTRY looks like in each registry format.
 *
 * Split from the writer so the shape of six formats sits in one readable table
 * instead of inside a 370-line file. The writer owns the read-modify-write; this
 * module owns "what does an entry look like here", and the two concerns do not
 * need to share a file to agree — `providerEntryFor` is pure.
 *
 * The dialect translation is the subtle half. A source names its wire format in
 * ITS vocabulary (omp's `api`, opencode's `npm` package, kimi's `type`), and the
 * target accepts a different spelling of the same fact. Passing the source's word
 * through blind writes a value the target rejects; guessing a mapping is how a
 * provider lands in a file the agent then ignores.
 */

import type { ProviderRegistryKind } from '@/shared/lib/harness/provider-facts';
import { ProviderWriteError } from '@/server/lib/harness/provider-write-error';

/** What an import brings into a target registry. */
export interface ProviderDraft {
  id: string;
  name: string;
  baseUrl?: string;
  /** The SOURCE's dialect. Translated per target format, never passed blind. */
  dialect?: string;
  models: string[];
  /** Read from the source at import time; never sent by the browser. */
  apiKey?: string;
}

/** A record, or an empty one. Imported documents are untrusted. */
export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** opencode's `npm` for a source dialect; the safe default when unknown. */
function npmFor(dialect: string | undefined): string {
  if (dialect?.startsWith('@ai-sdk/')) return dialect;
  switch (dialect) {
    case 'anthropic-messages':
    case 'anthropic': return '@ai-sdk/anthropic';
    case 'google-generative-ai':
    case 'gemini': return '@ai-sdk/google';
    case 'openai-responses':
    case 'openai_responses': return '@ai-sdk/openai';
    default: return '@ai-sdk/openai-compatible';
  }
}

/** kimi's `type` for a source dialect. */
function kimiType(dialect: string | undefined): string {
  switch (dialect) {
    case 'anthropic-messages':
    case 'anthropic': return 'anthropic';
    case 'google-generative-ai':
    case 'gemini': return 'gemini';
    case 'openai-responses':
    case 'openai_responses': return 'openai_responses';
    case 'kimi': return 'kimi';
    default: return 'openai_legacy';
  }
}

/**
 * codex's `wire_api` for a source dialect, or NULL when codex cannot speak it.
 *
 * codex has exactly two wire formats, both OpenAI's. An ANTHROPIC or GEMINI
 * endpoint imported into it would be written as `wire_api = "chat"` and every
 * request would fail against a gateway that never agreed to that protocol —
 * measured on a real import, which is why this returns null instead of a
 * default. A refusal that names the reason is the only honest answer.
 */
function codexWireApi(dialect: string | undefined): string | null {
  switch (dialect) {
    case undefined:
    case 'openai-completions':
    case 'chat':
    case '@ai-sdk/openai-compatible':
      return 'chat';
    case 'openai-responses':
    case 'openai_responses':
    case 'responses':
      return 'responses';
    default:
      return null;
  }
}

/** The provider entry in the TARGET format, before merging over what exists. */
export function providerEntryFor(
  kind: ProviderRegistryKind,
  draft: ProviderDraft,
): Record<string, unknown> {
  const name = draft.name || draft.id;
  switch (kind) {
    case 'yaml-providers':
      return {
        baseUrl: draft.baseUrl ?? '',
        ...(draft.apiKey ? { apiKey: draft.apiKey } : {}),
        api: draft.dialect ?? 'openai-completions',
        models: draft.models.map((id) => ({ id })),
      };
    case 'json-provider':
      return {
        npm: npmFor(draft.dialect),
        name,
        options: {
          ...(draft.baseUrl ? { baseURL: draft.baseUrl } : {}),
          ...(draft.apiKey ? { apiKey: draft.apiKey } : {}),
        },
        models: Object.fromEntries(draft.models.map((id) => [id, {}])),
      };
    case 'toml-model-providers': {
      const wireApi = codexWireApi(draft.dialect);
      if (!wireApi) {
        throw new ProviderWriteError(
          `codex cannot speak "${draft.dialect}": its wire formats are OpenAI's chat and responses only. `
          + 'Pick a provider whose endpoint speaks one of those, or keep this one in its own agent.',
        );
      }
      return {
        name,
        base_url: draft.baseUrl ?? '',
        // codex reads a VARIABLE NAME here, never the key itself. Storing the
        // secret in config.toml would put it in a file its own docs keep out of.
        ...(draft.apiKey ? { env_key: 'OPENAI_API_KEY' } : {}),
        wire_api: wireApi,
      };
    }
    case 'json-providers':
      return {
        name,
        baseUrl: draft.baseUrl ?? '',
        api: draft.dialect ?? 'openai-completions',
        ...(draft.apiKey ? { apiKey: draft.apiKey } : {}),
        models: draft.models.map((id) => ({ id })),
      };
    case 'toml-providers':
      return {
        type: kimiType(draft.dialect),
        base_url: draft.baseUrl ?? '',
        ...(draft.apiKey ? { api_key: draft.apiKey } : {}),
      };
    case 'json-model-providers':
      // qwen's rows ARE models, and the credential is a variable name.
      return {
        id: draft.models[0] ?? draft.id,
        name,
        ...(draft.baseUrl ? { baseUrl: draft.baseUrl } : {}),
        envKey: 'OPENAI_API_KEY',
      };
    default:
      throw new ProviderWriteError('This harness has no provider registry Kabmo writes');
  }
}
