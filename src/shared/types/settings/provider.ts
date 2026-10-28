/**
 * Where omp resolves a provider's credential from. The four values are omp's
 * own distinctions (its `/login` selector prints the same set as
 * `--api-key` / `config` / `login` / `api key` / `env`), folded to the ones
 * that change what the settings UI may offer: a provider authenticated by the
 * environment has nothing on disk to remove, so `sign out` cannot work on it.
 */
export type ProviderCredentialOrigin = 'models.yml' | 'api-key' | 'login' | 'environment';

export interface ProviderModel {
  id: string;
  name: string;
  contextWindow: string; // e.g. "1M ctx · 384K out"
  hasTools: boolean;
  hasVision: boolean;
  hasReasoning?: boolean;
  isVisible: boolean;
  /**
   * omp's `ModelKind` for this model (`chat`, `embedding`, `image`, `search`,
   * `judge`, …). Absent means chat — omp's own default.
   */
  kind?: string;
  /** The reasoning ladder the model declares, lowest first, when it thinks. */
  thinkingEfforts?: string[];
  /** `thinking.mode` from models.yml (`effort`, `budget`, `google-level`, …). */
  thinkingMode?: string;
  /** omp's pricing verdict for the row (`exact`, `estimated`, `unknown`). */
  pricingStatus?: string;
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
  | 'openai-decisions'
  | 'workers-ai-systemone'
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
   * WHERE omp resolves this provider's credential from, as the settings UI
   * names it. omp's own `/login` selector prints the same distinctions, and
   * folding them into one "connected" badge hid the case that matters most:
   * a provider authenticated by an environment variable has no stored
   * credential to remove, and `sign out` on it can only fail.
   *
   * - `models.yml` — an `apiKey` (or `!command`) in the provider entry
   * - `api-key` — an api-key credential in omp's `agent.db`
   * - `login` — an OAuth credential in omp's `agent.db`
   * - `environment` — an env var omp reads; nothing on disk
   */
  credentialOrigin?: ProviderCredentialOrigin;
  /** The provider is an OAuth provider omp can sign in to (`/login`). */
  oauth?: boolean;
  /** The provider is DISCOVERABLE — its own discovery/refresh is implemented. */
  available?: boolean;
  /** This provider has a row in Kabmo's SQLite overlay (visibility + sampling). */
  inOverlay?: boolean;
  /** Provider-level `headers` from models.yml, when the entry declares any. */
  headers?: Record<string, string>;
  /** `authHeader` from models.yml — send the credential as a raw auth header. */
  authHeader?: boolean;
  /** `transport` from models.yml (`pi-native` routes through the auth gateway). */
  transport?: 'pi-native';
  /**
   * The provider's own web icon, served from `/api/provider-icon` — the favicon
   * of the site its `baseUrl` points at.
   *
   * Present only once one has been FETCHED and stored. A `models.yml` provider
   * has no brand mark in Kabmo's table (nobody can ship a logo for a gateway a
   * user registered yesterday), so without this every such row fell back to its
   * initials. The URL carries the fetch time, so a changed icon is a changed
   * URL and no cache can pin the old picture.
   */
  iconUrl?: string;
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
