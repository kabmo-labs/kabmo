import { json } from '@/server/lib/remix-compat';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { methodNotAllowed } from '@/server/lib/route-adapter';
import { getDb } from '@/server/db.server';
import { DEFAULT_PROVIDERS_LIST, PRESET_NEW_PROVIDERS } from '@/client/data/settings/provider';
import { isMockMode } from '@/server/mock.server';
import type { ProviderItem } from '@/shared/types';
import { createSettingsListStore } from '@/server/lib/db/settings-store';
import { disableNativeProvider, enableNativeProvider } from '@/server/lib/omp/config/disabled-providers';
import { removeOmpProvider } from '@/server/lib/omp/config/providers';
import { PROVIDERS_SETTINGS_KEY as SETTINGS_KEY, deduplicateProviderItems, mergeProviders } from '@/server/lib/models/provider-registry.server';
import { invalidateModelsCaches } from '@/shared/lib/models/server-cache';

const providersStore = createSettingsListStore<ProviderItem>({
  key: SETTINGS_KEY,
  mockDefaults: DEFAULT_PROVIDERS_LIST,
  idOf: (provider) => provider.id,
  singular: 'provider',
  plural: 'providers',
});

async function readStoredProviders(): Promise<ProviderItem[]> {
  const db = await getDb();
  return providersStore.readStored(db, { absent: [] });
}

async function writeStoredProviders(providers: ProviderItem[]): Promise<void> {
  const db = await getDb();
  await providersStore.write(db, providers);
}

/**
 * Every provider mutation reshapes what the chat picker may offer, so both the
 * registry and the model-list caches are dropped on the way out.
 */
function respondWithProviders(providers: ProviderItem[], extra: Record<string, unknown> = {}) {
  invalidateModelsCaches();
  return json({ success: true, providers, ...extra });
}

/**
 * Connect / disconnect. The flag is written to omp's OWN registry
 * (config.yml disabledProviders) rather than the local overlay, because the
 * overlay is re-merged away on the next load — which is why a disconnect used
 * to come back as "connected".
 */
async function setProviderEnabled(slug: string, enabled: boolean): Promise<Response> {
  const mock = isMockMode();
  if (!mock) {
    if (enabled) await enableNativeProvider(slug);
    else await disableNativeProvider(slug);
  }
  // Must precede the merge: loadRpcProviderItems serves its 60s snapshot, so a
  // warm cache would rebuild the list against the OLD disabledProviders set.
  invalidateModelsCaches();
  const stored = await readStoredProviders();
  if (mock) {
    const target = slug.trim().toLowerCase();
    const updated = stored.map((provider) => (
      provider.slug.trim().toLowerCase() === target
        ? {
            ...provider,
            status: enabled ? ('connected' as const) : ('disconnected' as const),
            disabled: !enabled,
          }
        : provider
    ));
    await writeStoredProviders(updated);
    return respondWithProviders(updated);
  }
  return respondWithProviders((await mergeProviders(stored)).providers);
}

export async function loader({ request: _request }: LoaderFunctionArgs) {
  try {
    const db = await getDb();
    const mock = isMockMode();
    const providers = deduplicateProviderItems(await providersStore.read(db));

    if (!mock) {
      const merged = await mergeProviders(providers);
      return json({
        providers: merged.providers,
        presetProviders: PRESET_NEW_PROVIDERS,
        isMock: mock,
        modelsConfigPath: merged.modelsConfigPath,
        // Reported, not thrown: the provider list stays usable without the
        // catalog, and an empty model list with no explanation reads as "this
        // provider serves nothing".
        ...(merged.catalogError ? { catalogError: merged.catalogError } : {}),
      });
    }

    return json({
      providers,
      presetProviders: PRESET_NEW_PROVIDERS,
      isMock: mock,
    });
  } catch (error: any) {
    const mock = isMockMode();
    return json({
      error: error.message,
      providers: mock ? DEFAULT_PROVIDERS_LIST : [],
      presetProviders: PRESET_NEW_PROVIDERS,
      isMock: mock,
    }, { status: 500 });
  }
}

export async function action({ request, params }: ActionFunctionArgs) {
  try {
    const db = await getDb();

    if (request.method === 'DELETE') {
      const url = new URL(request.url);
      const id = url.searchParams.get('id');
      if (!id) return json({ error: 'id is required' }, { status: 400 });

      const stored = await readStoredProviders();
      // The target is looked up in the MERGED registry, not just the overlay.
      // A provider that exists only in models.yml has no overlay row at all, so
      // an overlay-only lookup found nothing, skipped the `removeOmpProvider`
      // call below, and reported a delete that had removed no file entry — the
      // provider came straight back on the next load.
      const merged = await mergeProviders(stored).catch(() => null);
      const target = merged?.providers.find((provider) => provider.id === id)
        ?? stored.find((provider) => provider.id === id);
      // A delete that can remove nothing is REFUSED with the reason. Three
      // providers reach here with no overlay row and no models.yml entry: one
      // omp authenticates from the environment, one it merely knows, and one it
      // discovered from the endpoint. Removing nothing and answering success is
      // the "delete did nothing" bug this reports instead.
      const inOverlay = stored.some((provider) => provider.id === id);
      const removesFileEntry = target?.inModelsYml === true && Boolean(target.slug);
      if (!inOverlay && !removesFileEntry) {
        return json({
          error: target?.credentialOrigin === 'environment'
            ? `${target.name} is authenticated by an environment variable — there is nothing in models.yml or Kabmo to delete. Unset the variable, or disable the provider instead.`
            : 'This provider has no models.yml entry and no Kabmo settings row, so there is nothing to delete. Disable it to hide it from the model list.',
        }, { status: 400 });
      }
      // The fallback list is MOCK-only demo data: seeding it in real mode would
      // write shipped sample providers into a user's overlay on the first
      // delete. Real mode starts from an empty overlay, which is what
      // `providersStore.read` already does for the loader.
      const fallback = isMockMode() ? DEFAULT_PROVIDERS_LIST : [];
      const list = await providersStore.remove(db, id, { absent: fallback, empty: fallback });

      // Removing the overlay row alone left the provider registered in
      // models.yml, so omp kept serving it and the next load merged it straight
      // back into this list — a delete that visibly did nothing. Unregister it
      // from the agent's own registry too.
      let removedFromOmp = false;
      let modelsRemoved = 0;
      if (target?.slug && !isMockMode()) {
        try {
          const removal = await removeOmpProvider(target.slug);
          removedFromOmp = removal.removed;
          modelsRemoved = removal.removedModels;
          // A provider omp still holds in disabledProviders would linger as a
          // "disconnected" ghost entry after its models are gone.
          await enableNativeProvider(target.slug);
        } catch (error) {
          // The overlay row is already gone; report the native failure instead
          // of failing the whole request, so the UI can tell the user the entry
          // is still in models.yml.
          const afterFailure = await mergeProviders(list).catch(() => null);
          return json({
            success: true,
            providers: afterFailure?.providers ?? list,
            removedFromOmp: false,
            warning: error instanceof Error ? error.message : 'models.yml cleanup failed',
          });
        }
      }
      invalidateModelsCaches();
      const after = await mergeProviders(list);
      return json({ success: true, providers: after.providers, removedFromOmp, modelsRemoved });
    }

    if (request.method === 'POST' || request.method === 'PUT') {
      const body = await request.json();

      if (typeof body.disableProvider === 'string') {
        return await setProviderEnabled(body.disableProvider, false);
      }
      if (typeof body.enableProvider === 'string') {
        return await setProviderEnabled(body.enableProvider, true);
      }

      // Never the demo list here: `DEFAULT_PROVIDERS_LIST` is shipped sample
      // data, and seeding it on a real install writes providers the user never
      // configured. Real mode starts from an empty overlay, exactly as the
      // loader's `providersStore.read` does.
      const fallback = isMockMode() ? DEFAULT_PROVIDERS_LIST : [];
      const updatedProviders = await providersStore.upsert(db, body, { absent: fallback, empty: fallback });
      await providersStore.write(db, updatedProviders);
      // The answer is the MERGED registry, not the overlay rows the caller just
      // sent. The overlay only holds per-model visibility and sampling, so
      // echoing it back replaced the panel's list with rows missing every
      // omp-derived field (status, dialect, credential origin) — the next
      // render then drew a provider as "not signed in" right after a save.
      if (isMockMode()) return respondWithProviders(updatedProviders);
      return respondWithProviders((await mergeProviders(updatedProviders)).providers);
    }

    return methodNotAllowed({ request, params });
  } catch (error: any) {
    return json({ error: error.message }, { status: 500 });
  }
}
