/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Model catalog types shared by the composer picker, the settings pages and
 * the `/api/models` route: the picker row (`AIModelOption`), the registry entry
 * (`ModelEntry`), the selection reference omp's `set_model` takes, and the
 * stored favorite/recent preference pair.
 *
 * Split out of `chat.ts` so that file stays under the per-file ceiling — the
 * picker's row shape is not part of the chat message model it was nested in.
 */

export interface AIModelOption {
  id: string;
  name: string;
  provider: string;
  providerIcon?: string;
  /** The provider's fetched web icon (see {@link ModelEntry.providerIconUrl}). */
  providerIconUrl?: string;
  contextWindow?: string | number;
  isCmdAgent?: boolean;
  /**
   * Favorite / last-used flag. On a picker row these are DERIVED from the
   * stored preference keys (`ModelPreferences`), never read off the registry —
   * a favorite is a Kabmo-local preference, not a property of omp's config.
   * On the MOCK catalog they are the seed for a fresh install's rails.
   */
  isFavorite?: boolean;
  /** MOCK seed only — the RECENT rail is ordered by `ModelPreferences.recentKeys`. */
  isRecent?: boolean;
  thinkingLevel?: string;
  /** Baked thinking ladder for this model: `["off", ...efforts]`. */
  thinkingLevels?: string[];
  capabilities?: string[];
  input?: string;
  output?: string;
  cost?: {
    input: string | number;
    output: string | number;
    cacheRead?: string | number;
    cacheWrite?: string | number;
  };
  description?: string;
}

// ── Real omp model registry (forked from omp-web) ──────────────────────────

/** One pickable model from the omp catalog (`/api/models` modelList). */
export interface ModelEntry {
  id: string;
  name: string;
  provider: string;
  /**
   * The provider's own web icon, when one has been fetched and stored.
   *
   * `/api/models` is read by the composer's picker, which draws a mark per
   * SECTION and per selected model. Without this the picker could only use the
   * built-in mark table, so a `models.yml` provider — the one kind the table
   * cannot know — showed its initials while the settings panel showed the site's
   * logo for the same provider.
   */
  providerIconUrl?: string;
  supportsFastMode?: boolean;
  contextWindow?: number;
  maxTokens?: number;
  /** Baked thinking ladder for this model: `["off", ...efforts]`. */
  thinkingLevels?: string[];
  /** Cost in $/1M tokens (omp catalog). */
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
}

/** A model selected by provider + modelId (omp's set_model shape). */
export interface SelectedModel {
  provider: string;
  modelId: string;
}

/** Model-level thinking metadata read off the live session state. */
export interface ThinkingModelMeta {
  provider: string;
  modelId: string;
  name?: string;
  reasoning?: boolean;
  thinking?: { efforts?: string[] };
}

/**
 * The user's favorite + last-used models, keyed by the composite `provider:id`
 * identity (`modelKey`). Stored separately from the model registry because the
 * registry is a read-only view of omp's config — a favorite is a Kabmo-local
 * preference, and an id-only key would light up every provider serving it.
 */
export interface ModelPreferences {
  /** Composite keys in the order the FAVORITES rail renders them. */
  favorites: string[];
  /** Composite keys, most recently used first, capped at `RECENT_MODELS_LIMIT`. */
  recentKeys: string[];
}

/** Response shape of GET /api/models (mirrors omp-web ModelsData). */
export interface ModelsData {
  models: Record<string, string>;
  modelList: ModelEntry[];
  defaultModel: SelectedModel | null;
  thinkingLevels: Record<string, string[]>;
  connectedProviders?: { id: string; name: string; disabled: boolean }[];
  modelError?: string;
  /** Absent when the settings row has never been written. */
  modelPreferences?: ModelPreferences;
}
