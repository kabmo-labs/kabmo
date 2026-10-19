export interface ProviderModel {
  id: string;
  name: string;
  contextWindow: string; // e.g. "1M ctx · 384K out"
  hasTools: boolean;
  hasVision: boolean;
  hasReasoning?: boolean;
  isVisible: boolean;
  /** USD per 1M tokens (unit of measure not obvious from the name alone). */
  priceInput?: number;
  priceOutput?: number;
  /** Cache read/write rates, from the models.dev catalog only. */
  priceCacheRead?: number;
  priceCacheWrite?: number;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  /**
   * Default reasoning effort written to models.yml `modelOverrides`. Mirrors
   * omp's `EffortSchema` vocabulary.
   */
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
}

/**
 * `api` values omp's `ApiSchema` accepts — the wire dialect a provider speaks.
 * Mirrors `models-config-schema-bundle.ts` in omp; a value here that omp does
 * not know makes it disable EVERY custom provider in the file at once.
 */
export type OmpProviderApi =
  | 'openai-completions'
  | 'openai-responses'
  | 'openai-codex-responses'
  | 'azure-openai-responses'
  | 'anthropic-messages'
  | 'bedrock-converse-stream'
  | 'google-generative-ai'
  | 'google-gemini-cli'
  | 'google-vertex'
  | 'openrouter-decisions'
  | 'typesafe';

/** omp's `ProviderAuthSchema`. `none` is what makes a local server keyless. */
export type ProviderAuthMode = 'apiKey' | 'none' | 'oauth';

/** omp's `ProviderDiscoverySchema.type` — how omp lists a provider's models itself. */
export type ProviderDiscoveryType =
  | 'ollama'
  | 'llama.cpp'
  | 'lm-studio'
  | 'openai-models-list'
  | 'proxy'
  | 'litellm'
  | 'apple-foundation-models';

/**
 * How a provider's models reach `models.yml`.
 *
 * - `fetch` — Kabmo lists the endpoint now and writes the ids in.
 * - `discovery` — omp lists them live from `discovery.type`; nothing is written.
 * - `override` — keep omp's bundled model list and only override the endpoint
 *   (the documented "override-only provider" shape).
 */
export type ProviderModelSource = 'fetch' | 'discovery' | 'override';

export interface ProviderItem {
  id: string;
  name: string;
  slug: string;
  icon: string;
  status: 'connected' | 'disconnected' | 'connecting';
  /**
   * Present in omp's own config.yml `disabledProviders`. A disabled provider is
   * excluded from the chat model picker entirely — independent of `status`, which
   * only says whether credentials resolve.
   */
  disabled?: boolean;
  configuredIn: string; // e.g. "auth credentials", "api key", "environment"
  /**
   * Where omp resolves this provider's credential from. The two are not
   * interchangeable in the UI: an `omp-auth` provider is signed in through
   * `/login` (the OAuth flow), while a `models.yml` provider carries its own
   * endpoint and key and is edited in place. Testing the provider ID instead
   * sent a keyless local server into a login flow it can never complete.
   */
  /**
   * Where this provider's credential is stored. `kabmo` is Kabmo's own provider
   * overlay row; `chamber` is the pre-rename spelling of the same value and is
   * still accepted from a row written before the rename.
   */
  credentialSource?: 'omp-auth' | 'models.yml' | 'kabmo' | 'chamber';
  /**
   * The provider HAS an entry in omp's own `models.yml`.
   *
   * Read from the file by the server rather than inferred on the client, because
   * it gates a destructive action: deleting removes that entry, and only the
   * server knows which slugs the file actually holds. A provider that exists
   * only in Kabmo overlay must not offer the button — there is nothing in
   * models.yml to delete.
   */
  inModelsYml?: boolean;
  apiKey?: string;
  baseUrl?: string;
  /** Wire dialect from models.yml. Absent for omp's bundled providers. */
  api?: OmpProviderApi;
  /** Auth mode from models.yml; `none` means the provider is keyless. */
  auth?: ProviderAuthMode;
  /** Live-discovery type from models.yml, when the provider declares one. */
  discovery?: ProviderDiscoveryType;
  /**
   * Where this provider's models come from. Persisted so the settings UI can
   * say WHY a provider legitimately has no model list — an endpoint override
   * for a bundled provider and a failed fetch look identical without it.
   */
  modelSource?: ProviderModelSource;
  models: ProviderModel[];
}

export interface PresetProviderOption {
  id: string;
  name: string;
  slug: string;
  icon: string;
  defaultUrl: string;
  /** Wire dialect the preset declares; omitted means "infer from the URL". */
  api?: OmpProviderApi;
  /** Auth mode the preset declares. `none` marks a keyless local server. */
  auth?: ProviderAuthMode;
  /** Preset pins a discovery type instead of fetching a model list. */
  discovery?: ProviderDiscoveryType;
  /** Preset configures a provider omp already bundles (override-only entry). */
  bundled?: boolean;
  /** Grouping label in the Add Provider picker. */
  group: string;
}
