/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The context window of the model the USER has selected, used as the fallback
 * limit wherever a session has not reported one yet.
 *
 * `CONTEXT_LIMIT` (1M) was a fixed assumption: a session with no assistant turn
 * yet, or one whose transcript names no model, rendered its context row against
 * a million tokens no matter which model was picked — a 256K model read as 8%
 * of a window it does not have. The composer's own pick is the only honest
 * answer available before a turn exists, and it is already persisted for the
 * scheduled-task runner (`omp_selected_model`), so both readers share one
 * source.
 *
 * Returns null when nothing is stored or the pick no longer resolves against
 * the live registry (a removed model, a disabled provider); callers then keep
 * the historical constant rather than inventing a window.
 */

import { getDb } from '@/server/db.server';
import { readSettingsJson } from '@/server/lib/db/settings-store';
import { loadModelsWithCache } from '@/server/lib/models/registry.server';

const SELECTED_MODEL_KEY = 'omp_selected_model';

interface StoredModelRef {
  provider?: unknown;
  modelId?: unknown;
  id?: unknown;
}

export async function resolveSelectedModelContextLimit(): Promise<number | null> {
  try {
    const db = await getDb();
    const stored = await readSettingsJson<StoredModelRef | null>(db, SELECTED_MODEL_KEY, null);
    if (!stored || typeof stored !== 'object') return null;
    const provider = typeof stored.provider === 'string' ? stored.provider : '';
    const modelId = typeof stored.modelId === 'string'
      ? stored.modelId
      : typeof stored.id === 'string' ? stored.id : '';
    if (!provider || !modelId) return null;

    const models = await loadModelsWithCache();
    const match = models.modelList.find(m => m.provider === provider && m.id === modelId);
    return match?.contextWindow ?? null;
  } catch {
    return null;
  }
}
