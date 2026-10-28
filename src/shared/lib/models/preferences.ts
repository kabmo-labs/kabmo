/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Favorite + recent model preferences, keyed by the composite `provider:id`
 * identity (`modelKey`). A model id alone is not unique — the omp registry
 * serves the same id from several providers — so an id-keyed favorite list
 * lights up every provider's row and records the wrong "recent".
 *
 * Pure list operations only: the server persists the arrays (one
 * `app_settings` row) and the picker applies them optimistically, so both
 * sides MUST agree on the ordering and the cap. Keeping the rules here is what
 * makes them agree — a second copy in the route or the hook would drift.
 */

import type { AIModelOption, ModelPreferences } from '@/shared/types';
import { modelKey } from '@/shared/lib/models/identity';

/** How many last-used models the RECENT rail holds. */
export const RECENT_MODELS_LIMIT = 5;

/** Used before the first write, and when a payload carries no preferences. */
export const EMPTY_MODEL_PREFERENCES: ModelPreferences = { favorites: [], recentKeys: [] };

/** Add or remove one key; the relative order of the survivors is untouched. */
export function toggleFavoriteKey(favorites: readonly string[], key: string): string[] {
  return favorites.includes(key)
    ? favorites.filter((entry) => entry !== key)
    : [...favorites, key];
}

/**
 * Move a key to the front of the recents, de-duplicated and capped. Re-picking
 * a model must not leave a second copy behind — the rail would then show the
 * same model twice and the cap would evict a genuinely older entry.
 */
export function recordRecentKey(
  recentKeys: readonly string[],
  key: string,
  limit: number = RECENT_MODELS_LIMIT,
): string[] {
  return [key, ...recentKeys.filter((entry) => entry !== key)].slice(0, Math.max(1, limit));
}

/**
 * Drop keys the live registry no longer offers — a model removed from
 * models.yml, or every model of a provider the user disconnected. Without this
 * a stale key holds one of the five recent slots forever, so a rail that looks
 * empty is hiding real entries behind keys nothing can render.
 */
export function filterKnownKeys(keys: readonly string[], known: ReadonlySet<string>): string[] {
  return keys.filter((key) => known.has(key));
}

/** Parse a persisted preferences row without trusting the JSON shape. */
export function readModelPreferences(value: unknown): ModelPreferences {
  const source = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
  const strings = (input: unknown): string[] =>
    Array.isArray(input) ? input.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0) : [];
  return {
    favorites: strings(source.favorites),
    recentKeys: strings(source.recentKeys).slice(0, RECENT_MODELS_LIMIT),
  };
}

/**
 * Stamp the favorite flag onto a catalog list. The registry carries no
 * favorites of its own — it is a read-only view of omp's config — so the picker
 * learns which rows are starred from the preference store, never from the
 * catalog's own `isFavorite` (that is MOCK seed data).
 *
 * The comparison is by truthiness, not identity: a registry row has no
 * `isFavorite` field at all, so an `undefined !== false` test would rebuild
 * every row on every load and re-render the whole panel. Rows whose star state
 * already reads correctly are returned untouched.
 */
export function applyModelPreferences(
  models: AIModelOption[],
  preferences: ModelPreferences,
): AIModelOption[] {
  const favorites = new Set(preferences.favorites);
  return models.map((model) => {
    const isFavorite = favorites.has(modelKey(model));
    return Boolean(model.isFavorite) === isFavorite ? model : { ...model, isFavorite };
  });
}
