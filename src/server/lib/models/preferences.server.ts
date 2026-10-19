/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Persistence for the user's favorite + last-used models.
 *
 * Lives apart from the model registry because a favorite is NOT a property of
 * omp's registry: the catalog the route used to mutate (`omp_models_catalog`)
 * is a MOCK-only demo list that real mode never reads back, so a star clicked
 * on a real install was written into a dead row and lost on the next render.
 * This store is the single source for both modes.
 *
 * Keys are composite (`provider:id`) — see `modelKey` — and stale ones are
 * dropped on read, so a model removed from models.yml cannot hold a slot in the
 * five-entry recent rail forever.
 */

import { getDb } from '@/server/db.server';
import { readSettingsJson, writeSettingsJson } from '@/server/lib/db/settings-store';
import { isMockMode } from '@/server/mock.server';
import { INITIAL_MODELS_CATALOG } from '@/client/data/models/catalog';
import {
  EMPTY_MODEL_PREFERENCES,
  RECENT_MODELS_LIMIT,
  filterKnownKeys,
  readModelPreferences,
  recordRecentKey,
  toggleFavoriteKey,
} from '@/shared/lib/models/preferences';
import { modelKey } from '@/shared/lib/models/identity';
import type { ModelPreferences } from '@/shared/types';

const MODEL_PREFERENCES_KEY = 'omp_model_preferences';

/**
 * Demo favorites/recents so a `MOCK=true` Kabmo still opens with the rails
 * the shipped catalog advertises. Seeded on first read only — from then on the
 * row is the user's, and the catalog's own flags are ignored.
 */
function mockSeedPreferences(): ModelPreferences {
  return {
    favorites: INITIAL_MODELS_CATALOG.filter((model) => model.isFavorite).map(modelKey),
    recentKeys: INITIAL_MODELS_CATALOG.filter((model) => model.isRecent).map(modelKey).slice(0, RECENT_MODELS_LIMIT),
  };
}

async function readStoredPreferences(): Promise<ModelPreferences> {
  const db = await getDb();
  const raw = await readSettingsJson<unknown>(db, MODEL_PREFERENCES_KEY, null);
  if (raw === null) return isMockMode() ? mockSeedPreferences() : EMPTY_MODEL_PREFERENCES;
  return readModelPreferences(raw);
}

/**
 * Preferences narrowed to the models the registry actually serves right now —
 * the shape every loader response carries.
 */
export async function readModelPreferencesFor(
  models: readonly { provider: string; id: string }[],
): Promise<ModelPreferences> {
  try {
    const known = new Set(models.map(modelKey));
    const stored = await readStoredPreferences();
    return {
      favorites: filterKnownKeys(stored.favorites, known),
      recentKeys: filterKnownKeys(stored.recentKeys, known),
    };
  } catch {
    return EMPTY_MODEL_PREFERENCES;
  }
}

/**
 * Persist a mutation with the stale keys already removed, so a key the registry
 * dropped cannot sit in the row holding one of the five recent slots. Reading
 * prunes for display only — without this the slot stayed occupied across
 * reloads and the RECENT rail silently showed four models instead of five.
 */
async function writePreferences(known: ReadonlySet<string>, mutate: (current: ModelPreferences) => ModelPreferences): Promise<ModelPreferences> {
  const current = await readStoredPreferences();
  const next = mutate({
    favorites: filterKnownKeys(current.favorites, known),
    recentKeys: filterKnownKeys(current.recentKeys, known),
  });
  const db = await getDb();
  await writeSettingsJson(db, MODEL_PREFERENCES_KEY, next);
  return next;
}

/** Flip one model's favorite flag, returning the full persisted pair. */
export async function toggleFavoritePreference(key: string, known: ReadonlySet<string>): Promise<ModelPreferences> {
  return writePreferences(known, (current) => ({
    ...current,
    favorites: toggleFavoriteKey(current.favorites, key),
  }));
}

/**
 * Record a model as last used. Called from the selection action rather than
 * from a separate endpoint: "the user picked this model" is one event, and a
 * second request would only add a way for the two to disagree.
 */
export async function recordRecentPreference(key: string, known: ReadonlySet<string>): Promise<ModelPreferences> {
  return writePreferences(known, (current) => ({
    ...current,
    recentKeys: recordRecentKey(current.recentKeys, key),
  }));
}
