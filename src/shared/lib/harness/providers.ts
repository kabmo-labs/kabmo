/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Providers, as a SURFACE: what each harness can do, what to call it, and how a
 * provider becomes one.
 *
 * The facts (which file, which field, writable or not) live in
 * `provider-facts.ts`, measured against each vendor's own reference. This module
 * turns them into what a card and a form need, and holds the one pure rule that
 * has to agree with the server: how a provider becomes env vars for an
 * `environment` harness.
 *
 * The old `PROVIDER_SUPPORT` table lived here and was WRONG in three places
 * (see `provider-facts.ts`): it invented an `opencode2.json` that does not
 * exist, called codex "no registry" when its own reference documents one, and
 * lumped pi/kimi/qwen/minimax in with it. It is gone rather than patched —
 * two tables would keep disagreeing about the same file.
 */

import type { HarnessId } from '@/shared/lib/harness/catalog';
import { providerFacts, type ProviderRegistryKind } from '@/shared/lib/harness/provider-facts';

/** The level a settings panel is drawn at. */
export type ProviderSupportLevel = 'full' | 'environment' | 'configurable' | 'none';

/** What the user is editing, named the way the agent names it. */
export function registryLabel(id: string | null | undefined): string {
  const { registry } = providerFacts(id);
  switch (registry.kind) {
    case 'yaml-providers': return 'models.yml (omp)';
    case 'json-provider': return 'opencode.json';
    case 'toml-model-providers': return 'config.toml (codex)';
    case 'json-providers': return 'models.json (pi)';
    case 'toml-providers': return 'config.toml (kimi)';
    case 'json-model-providers': return 'settings.json (qwen)';
    case 'zcode-provider-rules': return 'provider_config.json (zcode)';
    case 'agent-managed': return "the agent's own provider command";
    case 'env': return 'environment variables';
    default: return 'launch command and env';
  }
}

/** Which shape the card draws. */
export function providerLevel(id: string | null | undefined): ProviderSupportLevel {
  const facts = providerFacts(id);
  if (facts.registry.kind === 'env') return 'environment';
  if (facts.registry.kind === 'agent-managed') return 'configurable';
  if (!facts.registry.writable) return facts.registry.kind === 'none' ? 'none' : 'configurable';
  return 'full';
}

/** True when the settings page should draw a registry editor. */
export function supportsProviderEditor(id: string | null | undefined): boolean {
  return providerLevel(id) === 'full';
}

/**
 * The env a provider becomes for an `environment` harness.
 *
 * This is the entire "add a provider" action for Claude Code and Antigravity: a
 * base URL plus a key, under the vendor's own variable names, which is why the
 * form labels each field with the variable it becomes. A blank field writes NO
 * variable — an empty env var is a real thing to set, so the form must not do it
 * by accident.
 */
export function providerEnv(
  id: string | null | undefined,
  provider: { baseUrl: string; apiKey: string; model?: string },
): Record<string, string> {
  const contract = providerFacts(id).env;
  if (!contract) return {};
  const env: Record<string, string> = {};
  if (provider.baseUrl.trim()) env[contract.baseUrl] = provider.baseUrl.trim();
  if (provider.apiKey.trim()) env[contract.apiKey] = provider.apiKey.trim();
  if (contract.model && provider.model?.trim()) env[contract.model] = provider.model.trim();
  return env;
}

/**
 * Why a harness's editor is absent, when it is — the sentence the card shows
 * instead of a form.
 *
 * `agent-managed` gets its own wording: a registry EXISTS, Kabmo just must not
 * write it, and telling the reader "nothing to edit" would be false.
 */
export function providerAbsenceReason(id: string | null | undefined): string | null {
  const level = providerLevel(id);
  if (level === 'full') return null;
  if (level === 'environment') return null;
  if (level === 'none') return providerFacts(id).summary;
  return providerFacts(id).summary;
}

/**
 * The dialect field's VALUE vocabulary, per format.
 *
 * A writer must not invent a value the agent rejects. Each list is the one that
 * format's own reference documents; an empty list means the format has no such
 * field (qwen routes by protocol id, minimax by its own preset).
 */
export function dialectChoices(kind: ProviderRegistryKind): readonly { value: string; label: string }[] {
  switch (kind) {
    case 'yaml-providers':
    case 'json-providers':
      // omp's `api` and pi's `api` share the same vocabulary: both are the
      // vendor's own wire-format names.
      return [
        { value: 'openai-completions', label: 'OpenAI Chat Completions' },
        { value: 'openai-responses', label: 'OpenAI Responses' },
        { value: 'anthropic-messages', label: 'Anthropic Messages' },
        { value: 'google-generative-ai', label: 'Google Generative AI' },
      ];
    case 'json-provider':
      // opencode's `npm` IS the dialect: an SDK package name.
      return [
        { value: '@ai-sdk/openai-compatible', label: 'OpenAI-compatible SDK' },
        { value: '@ai-sdk/openai', label: 'OpenAI SDK' },
        { value: '@ai-sdk/anthropic', label: 'Anthropic SDK' },
        { value: '@ai-sdk/google', label: 'Google SDK' },
      ];
    case 'toml-model-providers':
      return [
        { value: 'chat', label: 'Chat Completions' },
        { value: 'responses', label: 'Responses' },
      ];
    case 'toml-providers':
      return [
        { value: 'openai_legacy', label: 'OpenAI Chat Completions' },
        { value: 'openai_responses', label: 'OpenAI Responses' },
        { value: 'anthropic', label: 'Anthropic' },
        { value: 'gemini', label: 'Google Gemini' },
        { value: 'kimi', label: 'Kimi' },
        { value: 'vertexai', label: 'Google Vertex AI' },
      ];
    case 'zcode-provider-rules':
      // The three wire types ZCode's provider reference documents. Google is
      // absent from its own enum, so it is not offered as a choice here.
      return [
        { value: 'anthropic-messages', label: 'Anthropic Messages' },
        { value: 'openai-chat-completions', label: 'OpenAI Chat Completions' },
        { value: 'openai-responses', label: 'OpenAI Responses' },
      ];
    default:
      return [];
  }
}

/** The label a format gives its own base-URL field, for the form's hint. */
export function baseUrlFieldLabel(id: string | null | undefined): string {
  const field = providerFacts(id).registry.baseUrlField;
  return field ?? 'base URL';
}

/** The label a format gives its own credential field. `env_key` in codex and
 *  qwen means the field holds a VARIABLE NAME, not the key itself — which a form
 *  has to say out loud or it will store a secret where a name belongs. */
export function credentialFieldLabel(id: string | null | undefined): string {
  const field = providerFacts(id).registry.apiKeyField;
  if (field === 'env_key' || field === 'envKey') return `${field} (a variable NAME)`;
  return field ?? 'api key';
}

/** True when the credential field holds the name of an environment variable. */
export function credentialIsEnvName(id: string | null | undefined): boolean {
  const field = providerFacts(id).registry.apiKeyField;
  return field === 'env_key' || field === 'envKey';
}

/** The harnesses whose registries this one can read entries from. */
export function importSourcesFor(id: string | null | undefined): readonly HarnessId[] {
  return providerFacts(id).importFrom;
}
