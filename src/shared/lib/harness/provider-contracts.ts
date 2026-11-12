/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The shapes the measured provider table is written in.
 *
 * Split from `provider-facts.ts` so the table module stays inside the file
 * ceiling as harnesses are added; the table is the one owner of the FACTS,
 * these are the one owner of their SHAPE.
 */

import type { HarnessId } from '@/shared/lib/harness/catalog';
import type { CanonicalProtocol } from '@/shared/lib/harness/dialects';

/** How a harness stores providers. */
export type ProviderRegistryKind =
  /** A YAML document with a `providers` map (omp). */
  | 'yaml-providers'
  /** A JSON document with a `provider` map (opencode). */
  | 'json-provider'
  /** A TOML document with a `model_providers` table (codex). */
  | 'toml-model-providers'
  /** A JSON document with a `providers` map (pi). */
  | 'json-providers'
  /** A TOML document with a `providers` table (kimi). */
  | 'toml-providers'
  /** A JSON settings document with `modelProviders` (qwen). */
  | 'json-model-providers'
  /** ZCode's personal-provider rules: arrays under `config.providerConfigRules`
   *  and `config.modelConfigRules` (3.12+). */
  | 'zcode-provider-rules'
  /** No provider registry this build writes; an env contract instead. */
  | 'env'
  /** A registry that exists but belongs to the agent's own writer. */
  | 'agent-managed'
  /** Nothing to offer. */
  | 'none';

export interface ProviderRegistry {
  kind: ProviderRegistryKind;
  /** Path relative to the user's home, or null when there is no file. */
  file: string | null;
  /** Dot-path the providers live under, for the editors and the reader. */
  pointer: string;
  /** False when Kabmo may read the entries but must not write them. */
  writable: boolean;
  /** The base-URL field's name in THIS format, so a writer does not guess. */
  baseUrlField: string | null;
  /** The API-key field's name in this format. */
  apiKeyField: string | null;
  /** The dialect/SDK field's name, when the format has one. */
  dialectField?: string;
  /** How this format spells a model entry, for the model list. */
  modelsField: string | null;
  /**
   * Provider ids this registry ships itself. An entry under one of these is the
   * VENDOR's provider with an endpoint override — not a custom provider — and an
   * import must never offer or write one: copying `anthropic` out of omp into
   * codex would replace the vendor entry instead of adding a gateway.
   */
  bundledIds?: readonly string[];
  /**
   * False when this registry writes a MODEL TABLE beside the provider (kimi's
   * `[models.<alias>]`, codex's `model`), so a provider alone serves nothing.
   * The writer then emits the model rows too instead of leaving a husk.
   */
  modelsAreRows?: boolean;
}

/**
 * One picker alias a vendor SDK resolves from the environment. Claude Code's
 * `opus`/`sonnet`/`haiku`/`fable` aliases resolve to ids the VENDOR ships
 * unless `ANTHROPIC_DEFAULT_<FAMILY>_MODEL` pins them; a gateway that lists
 * only its own ids answers the vendor ids with `400 model not found`.
 */
export interface EnvModelAlias {
  family: string;
  env: string;
}

/** The env names an `environment` harness reads, in the order its docs list. */
export interface EnvProviderContract {
  baseUrl: string;
  apiKey: string;
  model?: string;
  modelAliases?: readonly EnvModelAlias[];
}

export interface HarnessProviderFacts {
  registry: ProviderRegistry;
  /** Present only for an `env` harness. */
  env?: EnvProviderContract;
  /**
   * The single wire protocol an `environment` harness's SDK speaks. Claude Code
   * is Anthropic Messages and Antigravity is Google GenAI — an endpoint that
   * speaks neither cannot be carried there, and an import has to say so instead
   * of writing a URL the agent will fail every request against.
   */
  envProtocol?: CanonicalProtocol;
  /** True when adding a provider ADDS a choice; false when it replaces the
   *  agent's own endpoint (Claude Code, Antigravity). */
  createsChoice: boolean;
  /** Harnesses whose entries this one can import, because the fields line up. */
  importFrom: readonly HarnessId[];
  /** One sentence for the settings card, in the vendor's own vocabulary. */
  summary: string;
}
