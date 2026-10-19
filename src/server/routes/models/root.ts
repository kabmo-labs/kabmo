import { json } from '@/server/lib/remix-compat';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { getDb } from '@/server/db.server';
import { INITIAL_MODELS_CATALOG } from '@/client/data/models/catalog';
import { isMockMode } from '@/server/mock.server';
import type { AIModelOption, ModelsData, ProviderItem } from '@/shared/types';
import { readSettingsJson, writeSettingsJson } from '@/server/lib/db/settings-store';
import { modelKey } from '@/shared/lib/models/identity';
import {
  EMPTY_MODELS,
  SAFE_MODEL_LOAD_FAILURE_MESSAGE,
  invalidateModelsCache,
  loadModelsWithCache,
  readStoredProvidersForModels,
} from '@/server/lib/models/registry.server';
import {
  readModelPreferencesFor,
  recordRecentPreference,
  toggleFavoritePreference,
} from '@/server/lib/models/preferences.server';

const MODELS_CATALOG_KEY = 'omp_models_catalog';
const SELECTED_MODEL_KEY = 'omp_selected_model';

/** Error text for a 500 envelope without leaking a non-Error throw as `undefined`. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Parse a persisted { provider, modelId|id } reference without trusting the JSON shape. */
function readSelectedModelRef(value: unknown): { provider: string; modelId: string } | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as { provider?: unknown; modelId?: unknown; id?: unknown };
  if (typeof candidate.provider !== 'string' || candidate.provider.length === 0) return null;
  const modelId = candidate.modelId ?? candidate.id;
  if (typeof modelId !== 'string' || modelId.length === 0) return null;
  return { provider: candidate.provider, modelId };
}

/** The user's persisted pick resolved against the live registry; null when stale or unparseable. */
async function loadPersistedModelOption(modelList: ModelsData['modelList']): Promise<AIModelOption | null> {
  try {
    const db = await getDb();
    const selected = readSelectedModelRef(await readSettingsJson<unknown>(db, SELECTED_MODEL_KEY, null));
    if (!selected) return null;
    const match = modelList.find(m => m.id === selected.modelId && m.provider === selected.provider);
    if (!match) return null;
    return {
      id: match.id,
      name: match.name,
      provider: match.provider,
      contextWindow: match.contextWindow,
      thinkingLevels: match.thinkingLevels,
      thinkingLevel: match.thinkingLevels?.[0],
    };
  } catch {
    return null;
  }
}

/**
 * MOCK mode keeps the SQLite-backed demo catalog, but the favorite/recent
 * rails come from the same preference store as real mode — the catalog's own
 * `isFavorite`/`isRecent` flags are only its seed.
 */
async function loadMockModels() {
  const db = await getDb();
  const catalog = await readSettingsJson<unknown>(db, MODELS_CATALOG_KEY, null);
  const stored: AIModelOption[] = Array.isArray(catalog) && catalog.length > 0 ? catalog : INITIAL_MODELS_CATALOG;
  // Demo mode has no config.yml to read, so the disable flag lives on the
  // stored provider overlay. Filtering here keeps the model picker honest
  // in MOCK=true too — the settings page must be able to prove the switch.
  const disabledSlugs = new Set(
    (await readStoredProvidersForModels()).map((provider: ProviderItem) => provider.slug.trim().toLowerCase()),
  );
  const models = stored.filter((model) => !disabledSlugs.has(model.provider.trim().toLowerCase()));
  const persisted = await readSettingsJson<AIModelOption | null>(db, SELECTED_MODEL_KEY, null);
  // Every provider disabled ⇒ empty list and no selection; the composer must
  // see that honestly instead of holding on to a hidden provider's model.
  let selectedModel: AIModelOption | null = models[5] || models[0] || null;
  if (persisted && persisted.id && persisted.provider) {
    const match = models.find(m => m.id === persisted.id && m.provider === persisted.provider);
    if (match) selectedModel = match;
  }
  return { models, selectedModel, modelPreferences: await readModelPreferencesFor(models), isMock: true };
}

export async function loader({ request }: LoaderFunctionArgs) {
  // MOCK mode keeps the SQLite-backed catalog (Kabmo demo behavior).
  if (isMockMode()) {
    try {
      return json(await loadMockModels());
    } catch (error: unknown) {
      return json({
        error: errorMessage(error),
        models: INITIAL_MODELS_CATALOG,
        selectedModel: INITIAL_MODELS_CATALOG[5] || INITIAL_MODELS_CATALOG[0] || null,
        isMock: true,
      }, { status: 500 });
    }
  }

  // Real mode: read the omp model registry via the shared utility RPC process.
  // The ?cwd= query param is accepted for client compatibility but ignored —
  // the omp model registry (auth + models.yml) is global, not per-cwd.
  void request;
  try {
    const data = await loadModelsWithCache();
    // The selection and the preferences change independently of the 60s
    // registry cache, so both are read fresh on every request.
    return json({
      ...data,
      selectedModel: await loadPersistedModelOption(data.modelList),
      modelPreferences: await readModelPreferencesFor(data.modelList),
    });
  } catch {
    return json({ ...EMPTY_MODELS, modelError: SAFE_MODEL_LOAD_FAILURE_MESSAGE });
  }
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    const db = await getDb();
    const body = await request.json();
    const mock = isMockMode();

    const catalog = await readSettingsJson<unknown>(db, MODELS_CATALOG_KEY, null);
    // The shipped demo catalog is MOCK-only: a real install starts from an empty
    // list, so a demo model can never be persisted into its stored catalog.
    let models: AIModelOption[] = Array.isArray(catalog)
      ? catalog
      : (mock ? INITIAL_MODELS_CATALOG : []);

    const { actionType, modelId, provider, thinkingLevel, model, models: newModels } = body;

    /**
     * Composite keys the registry currently serves. Preference writes prune
     * against it so a model that left models.yml — or whose provider was
     * disconnected — cannot hold one of the five recent slots. Real mode reads
     * the same 60s-cached registry the loader serves; MOCK uses its demo list.
     */
    const knownModelKeys = async (): Promise<Set<string>> => {
      const live = mock ? models : (await loadModelsWithCache()).modelList;
      return new Set(live.map((entry) => modelKey(entry)));
    };

    // Model-scoped mutations must match provider + id: the registry serves the
    // same model id from several providers, so an id-only match rewrites the
    // first provider's entry instead of the one the user acted on.
    if (actionType === 'toggleFavorite' && modelId && provider) {
      // Favorites live in the preference store, NOT in the model catalog: the
      // catalog is a MOCK-only demo list that real mode never reads back, so a
      // star written there vanished on the next render.
      const preferences = await toggleFavoritePreference(modelKey({ provider, id: modelId }), await knownModelKeys());
      // Keep the demo catalog's flag in step so MOCK mode's own views agree.
      if (mock) {
        models = models.map(m => m.id === modelId && m.provider === provider ? { ...m, isFavorite: !m.isFavorite } : m);
        await writeSettingsJson(db, MODELS_CATALOG_KEY, models);
      }
      return json({ success: true, models, modelPreferences: preferences });
    }

    if (actionType === 'setThinking' && modelId && provider && thinkingLevel) {
      models = models.map(m => m.id === modelId && m.provider === provider ? { ...m, thinkingLevel } : m);
      await writeSettingsJson(db, MODELS_CATALOG_KEY, models);
      return json({ success: true, models });
    }

    if (actionType === 'toggleCmd' && modelId && provider) {
      models = models.map(m => m.id === modelId && m.provider === provider ? { ...m, isCmdAgent: !m.isCmdAgent } : m);
      await writeSettingsJson(db, MODELS_CATALOG_KEY, models);
      return json({ success: true, models });
    }

    if (actionType === 'selectModel' && model) {
      await writeSettingsJson(db, SELECTED_MODEL_KEY, model);
      const parsedModel = readSelectedModelRef(model);
      if (parsedModel) {
        invalidateModelsCache();
        // "The user picked this model" is one event: recording the recent here
        // keeps a second request from ever disagreeing with the selection.
        await recordRecentPreference(
          modelKey({ provider: parsedModel.provider, id: parsedModel.modelId }),
          await knownModelKeys(),
        );
      }
      return json({ success: true, selectedModel: model });
    }

    if (actionType === 'addModel' && model) {
      models.push(model);
      await writeSettingsJson(db, MODELS_CATALOG_KEY, models);
      return json({ success: true, models });
    }

    if (actionType === 'saveAll' && Array.isArray(newModels)) {
      await writeSettingsJson(db, MODELS_CATALOG_KEY, newModels);
      return json({ success: true, models: newModels });
    }

    return json({ error: 'Invalid action or parameters' }, { status: 400 });
  } catch (error: unknown) {
    return json({ error: errorMessage(error) }, { status: 500 });
  }
}
