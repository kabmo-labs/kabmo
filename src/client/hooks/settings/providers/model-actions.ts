/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Model-level actions for one provider: discovery refresh, the endpoint import,
 * visibility toggles and the per-model overrides.
 *
 * Split from `actions.ts` (provider-level: add, connect, enable/disable, delete)
 * because the two halves answer different questions and both were growing. The
 * distinction matters for reporting too: a provider-level failure leaves the
 * panel unchanged, while a model-level one has to say WHICH model it was about.
 */

import type { ProviderItem, ProviderModel } from '@/shared/types';
import { notifyModelsUpdated } from '@/shared/lib/models/client';
import { refreshProviderCatalog } from '@/shared/lib/models/provider/connection';
import {
  fetchProviderModelsRemote,
  replaceProviderModels,
  syncProviderModelsToCatalog,
} from '@/shared/lib/models/provider/models';
import { removeLegacyKenariModels } from '@/shared/lib/models/provider/cleanup';
import { fetchModelsMessage, fetchModelsNote, refreshModelsMessage } from '@/client/hooks/settings/providers/messages';
import { saveModelOverrideRemote } from '@/client/hooks/settings/providers/api';

export interface ModelActionsDeps {
  providers: ProviderItem[];
  selectedProvider: ProviderItem | undefined;
  isFetchingModels: boolean;
  pushToast: (message: string, tone: 'success' | 'error') => void;
  setProviders: (providers: ProviderItem[]) => void;
  setIsFetchingModels: (fetching: boolean) => void;
  persistProviders: (updated: ProviderItem[]) => Promise<void>;
  reloadProviders: () => Promise<ProviderItem[]>;
}

export function createModelActions(deps: ModelActionsDeps) {
  const {
    providers,
    selectedProvider,
    isFetchingModels,
    pushToast,
    setProviders,
    setIsFetchingModels,
    persistProviders,
    reloadProviders,
  } = deps;

  /**
   * Ask omp to re-run discovery (`omp models refresh`).
   *
   * This is omp's own refresh, not a Kabmo-side probe: the CLI re-mints
   * `!command` credentials and updates the catalog the chat picker reads, so the
   * panel and the agent cannot disagree about what a provider serves. It is
   * catalog-wide because that is the only granularity omp offers — the message
   * says so instead of implying per-provider discovery.
   */
  const handleRefreshModels = async () => {
    if (!selectedProvider || isFetchingModels) return;
    const target = selectedProvider;
    setIsFetchingModels(true);
    try {
      const result = await refreshProviderCatalog(target.slug);
      if (!result.ok) {
        pushToast(result.error || 'omp could not refresh the model catalog.', 'error');
        return;
      }
      if (result.providers) setProviders(result.providers);
      const message = refreshModelsMessage(target.name, result);
      pushToast(message.text, message.tone);
    } finally {
      setIsFetchingModels(false);
    }
  };

  /**
   * The listing probe: ask the ENDPOINT what it serves and write those ids into
   * `models.yml`.
   *
   * Only for a provider whose models are a static list. A discovery provider is
   * listed by omp itself, and writing a snapshot beside that live list is the
   * drift the writer's `overrideOnly` exists to prevent — the button carries a
   * block reason for those instead of quietly doing it.
   */
  const handleFetchModels = async () => {
    if (!selectedProvider || isFetchingModels) return;
    const target = selectedProvider;
    if (!target.baseUrl) {
      pushToast('This provider has no endpoint to import from — use “refresh” instead.', 'error');
      return;
    }
    setIsFetchingModels(true);
    try {
      const result = await fetchProviderModelsRemote({
        baseUrl: target.baseUrl,
        apiKey: target.apiKey,
        providerSlug: target.slug,
        persistToOmp: true,
        // The endpoint's list is the new list, not an addition to the old one.
        replaceModels: true,
        // The provider's own dialect decides the auth header the probe sends;
        // falling back to the URL classifier would send a Bearer header to an
        // Anthropic-shaped proxy that only accepts x-api-key.
        ...(target.api ? { api: target.api } : {}),
        ...(target.auth ? { auth: target.auth } : {}),
      });
      if (!result.ok || !result.models) {
        pushToast(result.error || 'Failed to fetch models from the provider.', 'error');
        return;
      }
      if (result.omp?.written) notifyModelsUpdated();
      const cleaned = removeLegacyKenariModels(target, target.models);
      const legacyRemoved = target.models.length - cleaned.length;
      const { added, addedCount, removedCount } = replaceProviderModels(cleaned, result.models);
      const droppedCount = removedCount + legacyRemoved;
      const message = fetchModelsMessage({ addedCount, removedCount: droppedCount });
      pushToast(message.text, message.tone);
      const note = fetchModelsNote(result);
      if (note) pushToast(note.text, note.tone);
      if (addedCount > 0) void syncProviderModelsToCatalog(target.name, added);
      await reloadProviders();
    } finally {
      setIsFetchingModels(false);
    }
  };

  const updateSelectedModels = (transform: (models: ProviderModel[]) => ProviderModel[]) => {
    if (!selectedProvider) return;
    void persistProviders(providers.map((provider) => (
      provider.id === selectedProvider.id ? { ...provider, models: transform(provider.models) } : provider
    )));
  };

  const handleHideAll = () => updateSelectedModels(
    (models) => models.map((model) => ({ ...model, isVisible: false })),
  );

  const handleShowAll = () => updateSelectedModels(
    (models) => models.map((model) => ({ ...model, isVisible: true })),
  );

  const handleToggleModelVisibility = (modelId: string) => updateSelectedModels(
    (models) => models.map((model) => (model.id === modelId ? { ...model, isVisible: !model.isVisible } : model)),
  );

  /**
   * Save the per-model knobs omp honours (`models.yml` modelOverrides). The
   * overlay still stores the display value so the dialog reopens where the user
   * left it, but omp only reads the override — writing just the overlay was the
   * bug that made these controls inert.
   */
  const handleSaveModelConfig = async (modelId: string, updates: Partial<ProviderModel>) => {
    if (!selectedProvider) return;
    const provider = selectedProvider;
    updateSelectedModels((models) => models.map((model) => (
      model.id === modelId ? { ...model, ...updates } : model
    )));

    const result = await saveModelOverrideRemote(provider.slug, modelId, updates);
    if (!result.ok) {
      pushToast(result.error || 'Failed to save the model configuration.', 'error');
      return;
    }
    if (result.written) notifyModelsUpdated();
    else if (result.reason) pushToast(result.reason, 'error');
  };

  return {
    handleRefreshModels,
    handleFetchModels,
    handleHideAll,
    handleShowAll,
    handleToggleModelVisibility,
    handleSaveModelConfig,
  };
}
