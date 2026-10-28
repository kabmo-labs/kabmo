/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Provider-level mutations behind Settings → Providers: add, connect, the
 * `models.yml` entry write, enable/disable, and delete.
 *
 * Split from the hook (`providers.ts`) so that file holds state wiring only, and
 * from `model-actions.ts` so the provider half stays about the provider. Every
 * action here is a write whose failure has to be reported, and keeping them
 * together means the "what does each mutation actually change" contract has one
 * home. `deps` is a single record rather than a positional list, so a caller
 * cannot silently pass the wrong setter.
 *
 * Three operations, and the panel used to have two of them wrong:
 *
 * - **connect** writes `models.yml` (`saveProviderEntry`) or runs omp's
 *   `/login`. The old "Save & Reconnect" wrote Kabmo's SQLite overlay, which the
 *   registry merge discards for any slug `models.yml` owns — the new key was
 *   stored where nothing reads it while the panel reported "connected".
 * - **disable / enable** writes `config.yml disabledProviders` and leaves the
 *   credential alone.
 * - **disconnect is GONE.** It called the same `setProviderEnabled` as disable
 *   and only differed in its toast, so it was a second name for one operation.
 *   Removing a credential is `sign out`; hiding a provider is `disable`.
 */

import type { ProviderItem } from '@/shared/types';
import { saveProviderOverlay, setProviderEnabled, deleteProvider } from '@/shared/lib/models/provider/connection';
import { addProviderMessage } from '@/client/hooks/settings/providers/messages';
import { loadProvidersFromApi } from '@/client/hooks/settings/providers/api';

export interface ProviderActionsDeps {
  providers: ProviderItem[];
  selectedProvider: ProviderItem | undefined;
  isDeletingProvider: boolean;
  pushToast: (message: string, tone: 'success' | 'error') => void;
  setProviders: (providers: ProviderItem[]) => void;
  setSelectedProviderId: (id: string) => void;
  setIsAddModalOpen: (open: boolean) => void;
  setIsDeleteModalOpen: (open: boolean) => void;
  setIsDeletingProvider: (deleting: boolean) => void;
  /** Opens the sign-in dialog for the provider being connected. */
  openLogin: () => void;
  /** Opens the `models.yml` entry editor for the provider being connected. */
  openEntryEditor: () => void;
  onAddModalClose?: () => void;
}

export function createProviderActions(deps: ProviderActionsDeps) {
  const {
    providers,
    selectedProvider,
    isDeletingProvider,
    pushToast,
    setProviders,
    setSelectedProviderId,
    setIsAddModalOpen,
    setIsDeleteModalOpen,
    setIsDeletingProvider,
    openLogin,
    openEntryEditor,
    onAddModalClose,
  } = deps;

  /** Publish an overlay edit and adopt the MERGED registry the server answers. */
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

  /** Re-read the merged registry — the source of truth after any file write. */
  const reloadProviders = async (): Promise<ProviderItem[]> => {
    const data = await loadProvidersFromApi();
    if (data) setProviders(data.providers);
    return data?.providers ?? [];
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
    const withoutExisting = providers.filter((provider) => provider.slug.trim().toLowerCase() !== slug);
    await persistProviders([...withoutExisting, newProvider]);
    const merged = await toggleProviderEnabled(newProvider.slug, true);
    const registered = merged?.find((provider) => provider.slug.trim().toLowerCase() === slug);
    setSelectedProviderId(registered?.id || newProvider.id);
    setIsAddModalOpen(false);
    onAddModalClose?.();

    const message = addProviderMessage(newProvider, options);
    pushToast(message.text, message.tone);
  };

  /**
   * The connection controls, one per thing the provider can actually do.
   *
   * A provider can be BOTH an OAuth login and a `models.yml` entry (an Anthropic
   * override pointing at a proxy is the common case), and collapsing them into
   * one button made whichever lost unreachable.
   */
  const handleConnect = (kind: 'login' | 'edit') => {
    if (!selectedProvider) return;
    // The provider's shape decided which buttons exist; this only routes the
    // press. `connectOffers` is the one place that decision lives.
    if (kind === 'login') openLogin();
    else openEntryEditor();
  };

  /** Called once the `models.yml` editor wrote an entry. */
  const handleEntrySaved = async (changed: string[]) => {
    if (!selectedProvider) return;
    pushToast(
      changed.length > 0
        ? `${selectedProvider.name}: updated ${changed.join(', ')} in models.yml.`
        : `${selectedProvider.name}: nothing to change.`,
      'success',
    );
    // The registry is the source of truth and the file just moved, so re-read
    // rather than patch: the panel's own copy came from the merge.
    await reloadProviders();
  };

  const handleOmpAuthSuccess = async () => {
    if (!selectedProvider) return;
    // omp stored the credential; re-read the registry rather than patching the
    // row, because a successful login also unlocks the provider's models (omp
    // re-runs that provider's discovery before the command returns).
    const slug = selectedProvider.slug;
    pushToast(`${selectedProvider.name} signed in — omp stored the credential.`, 'success');
    const refreshed = await reloadProviders();
    const next = refreshed.find((provider) => provider.slug === slug);
    if (next) setSelectedProviderId(next.id);
  };

  /**
   * Disable/enable from omp's own config.yml `disabledProviders`.
   *
   * This is the coarse switch that removes the provider — and every model it
   * serves — from the chat picker; the per-model eye toggle is the fine-grained
   * one. It is NOT a disconnect: the credential stays stored, which is what
   * makes re-enabling instant and what `sign out` exists for.
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
   * Delete a provider: its `models.yml` entry and/or its Kabmo overlay row.
   *
   * A refusal is reported verbatim. A provider omp authenticates from the
   * environment, or one it discovered from an endpoint, has nothing to delete —
   * and answering "success" for that was the delete-that-did-nothing bug the
   * server now refuses outright.
   */
  const handleDeleteProvider = async (target?: ProviderItem) => {
    const provider = target ?? selectedProvider;
    if (!provider || isDeletingProvider) return;
    setIsDeletingProvider(true);
    try {
      const result = await deleteProvider(provider.id);
      if (!result.ok) {
        pushToast(result.error || 'Failed to delete the provider.', 'error');
        return;
      }
      setIsDeleteModalOpen(false);
      const remaining = result.providers ?? [];
      if (selectedProvider?.id === provider.id) {
        setSelectedProviderId(remaining[0]?.id ?? '');
      }
      setProviders(remaining);
      // The overlay row is gone even when the file cleanup failed, so the
      // warning is reported rather than presented as a clean delete.
      if (result.warning) {
        pushToast(`${provider.name} removed from Kabmo, but models.yml cleanup failed: ${result.warning}`, 'error');
      } else if (result.removedFromOmp) {
        const count = result.modelsRemoved ?? 0;
        pushToast(
          `${provider.name} deleted from models.yml${count > 0 ? ` with its ${count} model${count === 1 ? '' : 's'}` : ''}.`,
          'success',
        );
      } else {
        pushToast(`${provider.name} removed from Kabmo.`, 'success');
      }
    } finally {
      setIsDeletingProvider(false);
    }
  };

  return {
    handleAddProvider,
    handleConnect,
    handleEntrySaved,
    handleOmpAuthSuccess,
    handleToggleProviderDisabled,
    handleDeleteProvider,
    persistProviders,
    reloadProviders,
  };
}
