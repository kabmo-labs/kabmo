/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The provider mutation actions behind Settings → Providers.
 *
 * Split from the hook (`providers.ts`) so that file holds state wiring only:
 * every action here is a write whose failure has to be reported, and keeping
 * them together means the "what does each mutation actually change" contract
 * has one home. `deps` is a single record rather than a positional list, so a
 * caller cannot silently pass the wrong setter.
 */

import type { ProviderItem, ProviderModel } from '@/shared/types';
import { notifyModelsUpdated } from '@/shared/lib/models/client';
import {
  deleteProvider,
  saveProviderOverlay,
  setProviderEnabled,
} from '@/shared/lib/models/provider/connection';
import {
  fetchProviderModelsRemote,
  replaceProviderModels,
  syncProviderModelsToCatalog,
} from '@/shared/lib/models/provider/models';
import { removeLegacyKenariModels } from '@/shared/lib/models/provider/cleanup';
import { addProviderMessage, fetchModelsMessage, fetchModelsNote } from '@/client/hooks/settings/providers/messages';
import { saveModelOverrideRemote } from '@/client/hooks/settings/providers/api';

export interface ProviderActionsDeps {
  providers: ProviderItem[];
  selectedProvider: ProviderItem | undefined;
  connectedProviders: ProviderItem[];
  isFetchingModels: boolean;
  isDeletingProvider: boolean;
  pushToast: (message: string, tone: 'success' | 'error') => void;
  setProviders: (providers: ProviderItem[]) => void;
  setSelectedProviderId: (id: string) => void;
  setIsAddModalOpen: (open: boolean) => void;
  setIsDeleteModalOpen: (open: boolean) => void;
  setIsDeletingProvider: (deleting: boolean) => void;
  setIsFetchingModels: (fetching: boolean) => void;
  onAddModalClose?: () => void;
}

export function createProviderActions(deps: ProviderActionsDeps) {
  const {
    providers,
    selectedProvider,
    connectedProviders,
    isFetchingModels,
    isDeletingProvider,
    pushToast,
    setProviders,
    setSelectedProviderId,
    setIsAddModalOpen,
    setIsDeleteModalOpen,
    setIsDeletingProvider,
    setIsFetchingModels,
    onAddModalClose,
  } = deps;

  /** Publish an overlay edit and adopt whatever the server merged back. */
  const persistProviders = async (updated: ProviderItem[]) => {
    setProviders(updated);
    try {
      const merged = await saveProviderOverlay(updated);
      if (merged) setProviders(merged);
    } catch (error) {
      console.error('Failed to save providers via API:', error);
      pushToast('Failed to save provider settings.', 'error');
    }
  };

  const toggleProviderEnabled = async (
    slug: string,
    enabled: boolean,
  ): Promise<ProviderItem[] | null> => {
    try {
      const merged = await setProviderEnabled(slug, enabled);
      if (merged) setProviders(merged);
      return merged;
    } catch (error) {
      console.error('Failed to update provider connection:', error);
      pushToast('Failed to update the provider connection.', 'error');
      return null;
    }
  };

  const handleAddProvider = async (
    newProvider: ProviderItem,
    options: { fetchedCount: number; ompNote?: string },
  ) => {
    // Replace by slug rather than append: an endpoint override reuses the slug
    // of a provider omp already ships, and two overlay rows for one slug would
    // let the stale one win the next merge.
    const slug = newProvider.slug.trim().toLowerCase();
    const withoutExisting = providers.filter((p) => p.slug.trim().toLowerCase() !== slug);
    await persistProviders([...withoutExisting, newProvider]);
    const merged = await toggleProviderEnabled(newProvider.slug, true);
    const registered = merged?.find((provider) => provider.slug.trim().toLowerCase() === slug);
    setSelectedProviderId(registered?.id || newProvider.id);
    setIsAddModalOpen(false);
    onAddModalClose?.();

    const message = addProviderMessage(newProvider, options);
    pushToast(message.text, message.tone);
  };

  const handleReconnect = async (updates: Partial<ProviderItem>) => {
    if (!selectedProvider) return;
    const target = selectedProvider;
    // A keyless provider stores no credential, so a masked placeholder echoed
    // back from the dialog must never be persisted as one — it would show a key
    // that authenticates nothing.
    const patch: Partial<ProviderItem> = target.auth === 'none'
      ? Object.fromEntries(Object.entries(updates).filter(([key]) => key !== 'apiKey'))
      : updates;
    await persistProviders(providers.map((p) => (
      p.id === target.id ? { ...p, ...patch, status: 'connected' as const } : p
    )));
    if (target.status !== 'connected') {
      await toggleProviderEnabled(target.slug, true);
    }
  };

  const handleFetchModels = async (credentials: { apiKey?: string; baseUrl?: string }) => {
    if (!selectedProvider || isFetchingModels) return;
    const baseUrl = credentials.baseUrl || selectedProvider.baseUrl;
    if (!baseUrl) {
      pushToast('Base URL is required to fetch models.', 'error');
      return;
    }
    setIsFetchingModels(true);
    try {
      const result = await fetchModelsFor(selectedProvider, baseUrl, credentials.apiKey);
      if (!result) return;
      if (result.omp?.written) notifyModelsUpdated();
    } finally {
      setIsFetchingModels(false);
    }
  };

  /**
   * The listing probe plus its reporting. Kept as one unit because the outcomes
   * — models added, models the endpoint no longer serves, legacy fallbacks
   * pruned, nothing changed — each have their own message, and a partial report
   * reads as a failed fetch.
   *
   * The listing REPLACES the provider's model list: the endpoint's answer is
   * what it serves now, so an id it dropped is removed here and from
   * `models.yml` (the request's `replaceModels`). An add-only merge is what
   * left models that no longer exist in the panel.
   */
  const fetchModelsFor = async (
    provider: ProviderItem,
    baseUrl: string,
    credential: string | undefined,
  ): Promise<{ omp?: { written: boolean; reason?: string } } | null> => {
    const result = await fetchProviderModelsRemote({
      baseUrl,
      apiKey: credential || provider.apiKey,
      providerSlug: provider.slug,
      persistToOmp: true,
      // The endpoint's list is the new list, not an addition to the old one.
      replaceModels: true,
      // The provider's own dialect decides the auth header the probe sends;
      // falling back to the URL classifier would send a Bearer header to an
      // Anthropic-shaped proxy that only accepts x-api-key.
      ...(provider.api ? { api: provider.api } : {}),
      ...(provider.auth ? { auth: provider.auth } : {}),
    });
    if (!result.ok || !result.models) {
      pushToast(result.error || 'Failed to fetch models from the provider.', 'error');
      return null;
    }
    const cleaned = removeLegacyKenariModels(provider, provider.models);
    const legacyRemoved = provider.models.length - cleaned.length;
    const { models, added, addedCount, removedCount } = replaceProviderModels(cleaned, result.models);
    const droppedCount = removedCount + legacyRemoved;
    if (addedCount > 0 || droppedCount > 0) {
      await handleReconnect({ models });
    }
    const message = fetchModelsMessage({ addedCount, removedCount: droppedCount });
    pushToast(message.text, message.tone);
    const note = fetchModelsNote(result);
    if (note) pushToast(note.text, note.tone);
    if (addedCount > 0) void syncProviderModelsToCatalog(provider.name, added);
    return { omp: result.omp };
  };

  const handleFetchModelsFromList = async () => {
    if (!selectedProvider) return;
    await handleFetchModels({
      apiKey: selectedProvider.apiKey,
      baseUrl: selectedProvider.baseUrl,
    });
  };

  const handleOmpAuthSuccess = () => {
    if (!selectedProvider) return;
    const target = selectedProvider;
    void persistProviders(providers.map((p) => (
      p.id === target.id ? { ...p, status: 'connected' as const } : p
    )));
    void toggleProviderEnabled(target.slug, true);
  };

  const handleToggleDisconnect = async () => {
    if (!selectedProvider) return;
    const target = selectedProvider;
    const disconnecting = target.status === 'connected';
    if (disconnecting) {
      setSelectedProviderId(connectedProviders.find((provider) => provider.id !== target.id)?.id || '');
    }
    const merged = await toggleProviderEnabled(target.slug, !disconnecting);
    if (!merged) return;
    pushToast(
      disconnecting
        ? `${target.name} disconnected — its models are no longer offered in the chat picker.`
        : `${target.name} reconnected.`,
      'success',
    );
  };

  const updateSelectedModels = (transform: (models: ProviderModel[]) => ProviderModel[]) => {
    if (!selectedProvider) return;
    void persistProviders(providers.map((p) => (
      p.id === selectedProvider.id ? { ...p, models: transform(p.models) } : p
    )));
  };

  /**
   * Disable/enable from omp's own config.yml `disabledProviders`. This is the
   * coarse switch that removes the provider — and every model it serves — from
   * the chat picker; the per-model eye toggle is the fine-grained one.
   */
  const handleToggleProviderDisabled = async () => {
    if (!selectedProvider) return;
    const target = selectedProvider;
    const disabling = target.disabled !== true;
    const merged = await toggleProviderEnabled(target.slug, !disabling);
    if (!merged) return;
    pushToast(
      disabling
        ? `${target.name} disabled — it no longer appears in the model list.`
        : `${target.name} enabled — its models are offered again.`,
      'success',
    );
  };

  /**
   * Delete a provider's `models.yml` entry (and Kabmo's overlay row).
   *
   * Only offered for a provider the server reports as `inModelsYml`, because
   * the action is a file edit: a login provider's credential is untouched, and
   * a provider with no file entry has nothing to delete. The selection moves off
   * the deleted provider BEFORE the list is republished — leaving it selected
   * would render a detail pane for a provider that no longer exists.
   */
  const handleDeleteProvider = async () => {
    if (!selectedProvider || isDeletingProvider) return;
    const target = selectedProvider;
    setIsDeletingProvider(true);
    try {
      const result = await deleteProvider(target.id);
      if (!result.ok) {
        pushToast(result.error || 'Failed to delete the provider.', 'error');
        return;
      }
      setIsDeleteModalOpen(false);
      const remaining = result.providers ?? [];
      setSelectedProviderId(remaining.find((provider) => provider.status === 'connected')?.id || '');
      setProviders(remaining);
      // The overlay row is gone even when the file cleanup failed, so the
      // warning is reported rather than presented as a clean delete.
      if (result.warning) {
        pushToast(`${target.name} removed from Kabmo, but models.yml cleanup failed: ${result.warning}`, 'error');
      } else if (result.removedFromOmp) {
        const count = result.modelsRemoved ?? 0;
        pushToast(
          `${target.name} deleted from models.yml${count > 0 ? ` with its ${count} model${count === 1 ? '' : 's'}` : ''}.`,
          'success',
        );
      } else {
        pushToast(`${target.name} removed from Kabmo list.`, 'success');
      }
    } finally {
      setIsDeletingProvider(false);
    }
  };

  const handleHideAll = () => updateSelectedModels(
    (models) => models.map((m) => ({ ...m, isVisible: false })),
  );

  const handleShowAll = () => updateSelectedModels(
    (models) => models.map((m) => ({ ...m, isVisible: true })),
  );

  const handleToggleModelVisibility = (modelId: string) => updateSelectedModels(
    (models) => models.map((m) => (m.id === modelId ? { ...m, isVisible: !m.isVisible } : m)),
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
    updateSelectedModels((models) => models.map((m) => (m.id === modelId ? { ...m, ...updates } : m)));

    const result = await saveModelOverrideRemote(provider.slug, modelId, updates);
    if (!result.ok) {
      pushToast(result.error || 'Failed to save the model configuration.', 'error');
      return;
    }
    if (result.written) notifyModelsUpdated();
    else if (result.reason) pushToast(result.reason, 'error');
  };

  return {
    handleAddProvider,
    handleReconnect,
    handleFetchModels,
    handleFetchModelsFromList,
    handleOmpAuthSuccess,
    handleToggleDisconnect,
    handleToggleProviderDisabled,
    handleDeleteProvider,
    handleHideAll,
    handleShowAll,
    handleToggleModelVisibility,
    handleSaveModelConfig,
  };
}
