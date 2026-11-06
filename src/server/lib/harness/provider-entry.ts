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
 * target accepts a different spelling of the same fact. A draft therefore carries
 * the CANONICAL protocol (`dialects.ts`), never the source's word: passing one
 * through blind writes a value the target rejects, and guessing a mapping is how
 * a provider lands in a file the agent then ignores. Measured reasons for the
 * rows below:
 *
 *  - codex now accepts `wire_api = "responses"` ONLY. A single `"chat"` entry
 *    makes every codex command fail at config load, so a Chat-Completions source
 *    is REFUSED here rather than relabelled.
 *  - kimi-code's types are `kimi|anthropic|openai|openai_responses|google-genai|
 *    vertexai`; the retired CLI's `openai_legacy`/`gemini` spellings are gone.
 *  - qwen routes by protocol BUCKET and stores a VARIABLE NAME (`envKey`), so the
 *    value has to be injected into `env` or all imported models answer 401.
 */

import type { ProviderRegistryKind } from '@/shared/lib/harness/provider-facts';
import type { CanonicalProtocol } from '@/shared/lib/harness/dialects';
import { dialectFor, wireApiFor } from '@/shared/lib/harness/dialects';
import { ProviderWriteError } from '@/server/lib/harness/provider-write-error';

/** What an import brings into a target registry. */
export interface ProviderDraft {
  id: string;
  name: string;
  baseUrl?: string;
  /** The CANONICAL wire protocol, already planned against the target. */
  protocol?: CanonicalProtocol;
  models: string[];
  /** Read from the source at import time; never sent by the browser. */
  apiKey?: string;
  /**
   * Context window per model id, when the source declared one. kimi REQUIRES
   * `max_context_size`, so an import without it cannot produce a usable alias.
   */
  contextWindow?: Record<string, number>;
}

/** A record, or an empty one. Imported documents are untrusted. */
export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** The dialect value a target writes for this draft, or a refusal naming both. */
function requireDialect(kind: ProviderRegistryKind, draft: ProviderDraft, target: string): string {
  const protocol = draft.protocol;
  if (!protocol) {
    throw new ProviderWriteError(
      `Cannot copy "${draft.id}" into ${target}: the source declares no wire protocol Kabmo can verify, `
      + 'and guessing one writes a provider the agent will fail every request against.',
    );
  }
  const dialect = dialectFor(kind, protocol);
  if (dialect === null) {
    throw new ProviderWriteError(
      `${target} cannot speak ${protocol}: it stores no such dialect. `
      + 'Pick a provider whose endpoint speaks one of the protocols this agent accepts, or keep it in its own agent.',
    );
  }
  return dialect;
}

/** kimi requires a context window per alias; 128k is the documented fallback. */
const DEFAULT_CONTEXT_WINDOW = 128_000;

/**
 * The provider entry in the TARGET format, before merging over what exists.
 *
 * `target` appears only in the refusal messages, so a user reading one knows
 * which agent said no.
 */
export function providerEntryFor(
  kind: ProviderRegistryKind,
  draft: ProviderDraft,
  target = 'this agent',
): Record<string, unknown> {
  const name = draft.name || draft.id;
  switch (kind) {
    case 'yaml-providers':
      return {
        // omp keys the entry by slug and prints the slug; its docs and `omp models`
        // both accept a `name`, so the display name a user typed survives the
        // write instead of being replaced by `my-gateway` in every picker.
        ...(name && name !== draft.id ? { name } : {}),
        baseUrl: draft.baseUrl ?? '',
        ...(draft.apiKey ? { apiKey: draft.apiKey } : {}),
        api: requireDialect(kind, draft, target),
        models: draft.models.map((id) => ({ id })),
      };
    case 'json-provider':
      return {
        npm: requireDialect(kind, draft, target),
        name,
        options: {
          ...(draft.baseUrl ? { baseURL: draft.baseUrl } : {}),
          ...(draft.apiKey ? { apiKey: draft.apiKey } : {}),
        },
        models: Object.fromEntries(draft.models.map((id) => [id, {}])),
      };
    case 'toml-model-providers':
      return {
        name,
        base_url: draft.baseUrl ?? '',
        // codex reads a VARIABLE NAME here, never the key itself. Storing the
        // secret in config.toml would put it in a file its own docs keep out of;
        // the writer injects the value into the harness env instead. The name is
        // per PROVIDER for the same reason it is on qwen: one shared name means
        // the second provider added re-points the first at another key.
        ...(draft.apiKey ? { env_key: `${draft.id.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY` } : {}),
        wire_api: requireDialect(kind, draft, target),
      };
    case 'json-providers':
      return {
        name,
        baseUrl: draft.baseUrl ?? '',
        api: requireDialect(kind, draft, target),
        ...(draft.apiKey ? { apiKey: draft.apiKey } : {}),
        models: draft.models.map((id) => ({ id })),
      };
    case 'toml-providers':
      return {
        type: requireDialect(kind, draft, target),
        base_url: draft.baseUrl ?? '',
        ...(draft.apiKey ? { api_key: draft.apiKey } : {}),
      };
    case 'json-model-providers':
      // qwen's rows ARE models, and the credential is a variable name.
      return {
        id: draft.models[0] ?? draft.id,
        name,
        ...(draft.baseUrl ? { baseUrl: draft.baseUrl } : {}),
        ...(wireApiFor(draft.protocol ?? 'openai-chat') ? { wireApi: wireApiFor(draft.protocol ?? 'openai-chat') } : {}),
        // ONE variable per provider: a fixed name made the second provider added
        // to qwen silently re-point the first at its own key.
        envKey: `${draft.id.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`,
      };
    default:
      throw new ProviderWriteError('This harness has no provider registry Kabmo writes');
  }
}

/**
 * The `[models.<alias>]` rows a provider needs to serve anything.
 *
 * kimi-code selects models by ALIAS, and an alias requires `provider`, `model`
 * and `max_context_size` — a provider written without them is invisible to the
 * agent's model picker, which is what an import looked like before this existed.
 * The alias is prefixed with the provider id so two providers serving the same
 * model id do not collide, the same way kimi's own imports name them.
 */
export function modelRowsFor(
  kind: ProviderRegistryKind,
  draft: ProviderDraft,
): Record<string, Record<string, unknown>> {
  if (kind !== 'toml-providers' || !draft.models.length) return {};
  const rows: Record<string, Record<string, unknown>> = {};
  for (const modelId of draft.models) {
    const alias = `${draft.id}/${modelId}`;
    rows[alias] = {
      provider: draft.id,
      model: modelId,
      max_context_size: draft.contextWindow?.[modelId] ?? DEFAULT_CONTEXT_WINDOW,
    };
  }
  return rows;
}
