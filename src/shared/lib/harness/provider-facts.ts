/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Where each harness keeps its providers, MEASURED — not assumed.
 *
 * Every entry below names a file (or an env contract) that was checked on a real
 * install or taken from the vendor's own configuration reference. The first
 * version of this table guessed, and guessed wrong in three places:
 *
 *  - `opencode2` was given its own `opencode2.json`. Measured: the 2.x binary
 *    reads `$XDG_CONFIG_HOME/opencode/opencode.json` — the SAME file 1.x reads.
 *    A provider added to one appears in both, so the "two registries" idea was a
 *    fiction that would have split one real file into two imaginary ones.
 *  - `codex` was called `configurable` (no registry). Its own reference documents
 *    `[model_providers.<id>]` in `~/.codex/config.toml`, with `name`, `base_url`,
 *    `env_key`, `wire_api` and `http_headers`. It is a full registry.
 *  - `pi`, `kimi`, `qwen`, `minimax` and `dsh` were lumped in as "no registry".
 *    Each has one: `models.json`, `~/.kimi/config.toml` `[providers.<id>]`,
 *    `settings.json` `modelProviders`, BYOK providers, and a Cordis profile patch.
 *
 * Formats differ, and that difference is the work — not a detail to smooth over:
 *
 * | Harness | File | Shape |
 * |---|---|---|
 * | omp | `~/.omp/agent/models.yml` | `providers.<slug>` → `{baseUrl, apiKey, api, models: [{id, name, contextWindow, cost}]}` |
 * | opencode | `$XDG_CONFIG_HOME/opencode/opencode.json` | `provider.<id>` → `{npm, name, options:{baseURL, apiKey}, models: {<id>: {name}}}` |
 * | codex | `~/.codex/config.toml` | `[model_providers.<id>]` → `{name, base_url, env_key, wire_api, http_headers}` |
 * | pi | `~/.pi/agent/models.json` | `providers.<id>` → `{name, baseUrl, api, apiKey, models: [{id, name, contextWindow, cost}]}` |
 * | kimi | `~/.kimi/config.toml` | `[providers.<id>]` → `{type, base_url, api_key, custom_headers}` |
 * | qwen | `~/.qwen/settings.json` | `modelProviders.<protocol>` → array of `{id, baseUrl, envKey}` |
 * | minimax | its own BYOK store, written by `mcode` | not a file Kabmo may edit |
 * | claude | env only | `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN` |
 * | antigravity | env only | `GOOGLE_GEMINI_BASE_URL`, `GEMINI_API_KEY` |
 * | cursor, dsh | none Kabmo can write | the launch line and its env |
 *
 * A file Kabmo may READ but must not WRITE is marked `readOnly`: minimax keeps its
 * BYOK entries behind `mcode`'s own writer, and rewriting that store from outside
 * is how a working agent stops signing in.
 */

import type { HarnessId } from '@/shared/lib/harness/catalog';

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
}

/** The env names an `environment` harness reads, in the order its docs list. */
export interface EnvProviderContract {
  baseUrl: string;
  apiKey: string;
  model?: string;
}

export interface HarnessProviderFacts {
  registry: ProviderRegistry;
  /** Present only for an `env` harness. */
  env?: EnvProviderContract;
  /** True when adding a provider ADDS a choice; false when it replaces the
   *  agent's own endpoint (Claude Code, Antigravity). */
  createsChoice: boolean;
  /** Harnesses whose entries this one can import, because the fields line up. */
  importFrom: readonly HarnessId[];
  /** One sentence for the settings card, in the vendor's own vocabulary. */
  summary: string;
}

/**
 * The table. A harness missing here is `none` — and `providerFacts` says so
 * rather than defaulting to something that would offer an editor.
 */
export const HARNESS_PROVIDER_FACTS: Readonly<Partial<Record<HarnessId, HarnessProviderFacts>>> = {
  'omp-rpc': {
    registry: {
      kind: 'yaml-providers', file: '.omp/agent/models.yml', pointer: 'providers',
      writable: true, baseUrlField: 'baseUrl', apiKeyField: 'apiKey',
      dialectField: 'api', modelsField: 'models',
    },
    createsChoice: true,
    importFrom: ['opencode', 'codex', 'pi', 'kimi', 'qwen'],
    summary: 'omp keeps providers in models.yml. Providers added here are added, not substituted.',
  },
  'omp-acp': {
    registry: {
      kind: 'yaml-providers', file: '.omp/agent/models.yml', pointer: 'providers',
      writable: true, baseUrlField: 'baseUrl', apiKeyField: 'apiKey',
      dialectField: 'api', modelsField: 'models',
    },
    createsChoice: true,
    importFrom: ['opencode', 'codex', 'pi', 'kimi', 'qwen'],
    summary: 'The same models.yml omp over RPC uses — one registry, whichever transport runs the chat.',
  },
  opencode: {
    registry: {
      kind: 'json-provider', file: '.config/opencode/opencode.json', pointer: 'provider',
      writable: true, baseUrlField: 'options.baseURL', apiKeyField: 'options.apiKey',
      dialectField: 'npm', modelsField: 'models',
    },
    createsChoice: true,
    importFrom: ['omp-rpc', 'codex', 'pi', 'kimi', 'qwen'],
    summary: 'opencode reads providers from opencode.json, with an npm SDK per provider and a model map. Added beside the vendored ones.',
  },
  codex: {
    registry: {
      kind: 'toml-model-providers', file: '.codex/config.toml', pointer: 'model_providers',
      writable: true, baseUrlField: 'base_url', apiKeyField: 'env_key',
      dialectField: 'wire_api', modelsField: null,
    },
    createsChoice: true,
    importFrom: ['omp-rpc', 'opencode', 'pi', 'kimi'],
    summary: 'codex defines providers in config.toml under [model_providers.<id>]; model_provider selects the active one.',
  },
  pi: {
    registry: {
      kind: 'json-providers', file: '.pi/agent/models.json', pointer: 'providers',
      writable: true, baseUrlField: 'baseUrl', apiKeyField: 'apiKey',
      dialectField: 'api', modelsField: 'models',
    },
    createsChoice: true,
    importFrom: ['omp-rpc', 'opencode', 'codex'],
    summary: 'pi reads providers from models.json; each needs a baseUrl and an api.',
  },
  kimi: {
    registry: {
      kind: 'toml-providers', file: '.kimi/config.toml', pointer: 'providers',
      writable: true, baseUrlField: 'base_url', apiKeyField: 'api_key',
      dialectField: 'type', modelsField: null,
    },
    createsChoice: true,
    importFrom: ['omp-rpc', 'opencode', 'pi'],
    summary: 'kimi reads [providers.<id>] from config.toml, with a `type` that names the wire protocol.',
  },
  qwen: {
    registry: {
      kind: 'json-model-providers', file: '.qwen/settings.json', pointer: 'modelProviders',
      writable: true, baseUrlField: 'baseUrl', apiKeyField: 'envKey',
      modelsField: null,
    },
    createsChoice: true,
    importFrom: ['omp-rpc', 'opencode'],
    summary: 'qwen lists model routes under modelProviders, grouped by protocol; credentials stay in the environment.',
  },
  'command-code': {
    registry: {
      // `~/.commandcode/providers.json` exists, but its shape is written by
      // `cmd /connect` and is not documented — so it is read for display and
      // never used as an import source. Copying a shape Kabmo cannot vouch for is
      // how an import writes something the agent then refuses.
      kind: 'agent-managed', file: '.commandcode/providers.json', pointer: 'providers',
      writable: false, baseUrlField: null, apiKeyField: null, modelsField: null,
    },
    createsChoice: true,
    importFrom: [],
    summary: 'Command Code adds providers with `cmd /connect`, which writes its own providers.json. The models it publishes then appear in Kabmo.',
  },
  minimax: {
    registry: {
      kind: 'agent-managed', file: null, pointer: 'mcode BYOK',
      writable: false, baseUrlField: null, apiKeyField: null, modelsField: null,
    },
    createsChoice: true,
    importFrom: [],
    summary: 'MiniMax stores BYOK providers itself; add one with `mcode`, and Kabmo will see the models it publishes.',
  },
  claude: {
    registry: {
      kind: 'env', file: null, pointer: 'environment',
      writable: true, baseUrlField: null, apiKeyField: null, modelsField: null,
    },
    env: { baseUrl: 'ANTHROPIC_BASE_URL', apiKey: 'ANTHROPIC_AUTH_TOKEN', model: 'ANTHROPIC_MODEL' },
    createsChoice: false,
    importFrom: ['omp-rpc', 'opencode', 'codex', 'pi', 'kimi', 'qwen'],
    summary: 'Claude Code has no provider registry: ANTHROPIC_BASE_URL and ANTHROPIC_AUTH_TOKEN point every request at one endpoint. Setting them REPLACES Anthropic.',
  },
  antigravity: {
    registry: {
      kind: 'env', file: null, pointer: 'environment',
      writable: true, baseUrlField: null, apiKeyField: null, modelsField: null,
    },
    env: { baseUrl: 'GOOGLE_GEMINI_BASE_URL', apiKey: 'GEMINI_API_KEY' },
    createsChoice: false,
    importFrom: ['omp-rpc', 'opencode', 'codex', 'pi', 'kimi', 'qwen'],
    summary: 'Antigravity reads GEMINI_API_KEY and GOOGLE_GEMINI_BASE_URL, and only when modelProvider is `gemini`. It REPLACES the signed-in account.',
  },
  dsh: {
    registry: {
      kind: 'none', file: null, pointer: '—',
      writable: false, baseUrlField: null, apiKeyField: null, modelsField: null,
    },
    createsChoice: false,
    importFrom: [],
    summary: 'No provider registry Kabmo can write; the launch command and env are the whole surface.',
  },
  cursor: {
    registry: {
      kind: 'none', file: null, pointer: '—',
      writable: false, baseUrlField: null, apiKeyField: null, modelsField: null,
    },
    createsChoice: false,
    importFrom: [],
    summary: 'Signed in with its own auth flow; no provider registry to edit.',
  },
};

/** The facts for a harness, or the honest "nothing to offer" record. */
export function providerFacts(id: string | null | undefined): HarnessProviderFacts {
  const entry = id ? (HARNESS_PROVIDER_FACTS as Record<string, HarnessProviderFacts | undefined>)[id] : undefined;
  return entry ?? {
    registry: {
      kind: 'none', file: null, pointer: '—',
      writable: false, baseUrlField: null, apiKeyField: null, modelsField: null,
    },
    createsChoice: false,
    importFrom: [],
    summary: 'This build knows nothing about providers for that harness.',
  };
}

/** True when the settings page should draw a registry editor. */
export function managesProviders(id: string | null | undefined): boolean {
  const registry = providerFacts(id).registry;
  return registry.writable && registry.kind !== 'env' && registry.kind !== 'none';
}
