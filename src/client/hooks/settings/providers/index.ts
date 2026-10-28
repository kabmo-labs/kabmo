/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * State wiring for Settings → Providers: the merged registry, the selection,
 * the dialog flags, and the actions (`providers/actions.ts`).
 *
 * Two rules this file carries:
 *
 * - the sidebar lists EVERY provider omp knows — including one with no
 *   credential, which is the row you click to sign it in. omp's own `/models`
 *   hub draws them the same way, and filtering them out made an OAuth provider
 *   that had never been signed in unreachable from the panel that signs it in;
 * - `disabled` is kept separate from `status`, because a provider hidden on
 *   purpose is not the same as one whose credential is missing, and the switch
 *   that hid it has to stay reachable.
 */

import { useEffect, useMemo, useState } from 'preact/hooks';
import type { PresetProviderOption, ProviderItem } from '@/shared/types';
import { buildAvailableProviderPresets, configuredProviderSlugs } from '@/shared/lib/models/provider/presets';
import { useToasts } from '@/client/hooks/ui/toasts';
import { createProviderActions } from '@/client/hooks/settings/providers/actions';
import { createModelActions } from '@/client/hooks/settings/providers/model-actions';
import { loadProvidersFromApi } from '@/client/hooks/settings/providers/api';

export interface UseProviderSettingsOptions {
  autoOpenAdd?: boolean;
  onAddModalClose?: () => void;
}

export function useProviderSettings({
  autoOpenAdd = false,
  onAddModalClose,
}: UseProviderSettingsOptions = {}) {
  const [providers, setProviders] = useState<ProviderItem[]>([]);
  const [presetProviders, setPresetProviders] = useState<PresetProviderOption[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<string>('');
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const { toasts, pushToast, dismissToast } = useToasts();

  const [isAddModalOpen, setIsAddModalOpen] = useState(autoOpenAdd);
  const [isAddModelModalOpen, setIsAddModelModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);
  const [isDeletingProvider, setIsDeletingProvider] = useState(false);
  const [isEntryModalOpen, setIsEntryModalOpen] = useState(false);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [configModel, setConfigModel] = useState<ProviderItem['models'][number] | null>(null);
  const [capabilitiesModel, setCapabilitiesModel] = useState<ProviderItem['models'][number] | null>(null);

  useEffect(() => {
    if (autoOpenAdd) setIsAddModalOpen(true);
  }, [autoOpenAdd]);

  useEffect(() => {
    let active = true;
    void loadProvidersFromApi().then((data) => {
      if (!active) return;
      setIsLoading(false);
      if (!data) return;
      setProviders(data.providers);
      setPresetProviders(data.presetProviders ?? []);
      setCatalogError(data.catalogError ?? null);
      const connected = data.providers.filter((provider) => provider.status === 'connected');
      setSelectedProviderId(connected[0]?.id ?? data.providers[0]?.id ?? '');
    });
    return () => { active = false; };
  }, []);

  const availablePresetProviders = useMemo(
    () => buildAvailableProviderPresets(providers, presetProviders),
    [providers, presetProviders],
  );
  const existingSlugs = useMemo(() => configuredProviderSlugs(providers), [providers]);
  // The selection is resolved against the FULL list: a provider with no
  // credential is selectable, because its detail pane is where the sign-in
  // control lives.
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId)
    ?? providers[0];

  const providerActions = createProviderActions({
    providers,
    selectedProvider,
    isDeletingProvider,
    pushToast,
    setProviders,
    setSelectedProviderId,
    setIsAddModalOpen,
    setIsDeleteModalOpen,
    setIsDeletingProvider,
    openLogin: () => setIsLoginModalOpen(true),
    openEntryEditor: () => setIsEntryModalOpen(true),
    ...(onAddModalClose ? { onAddModalClose } : {}),
  });
  const modelActions = createModelActions({
    providers,
    selectedProvider,
    isFetchingModels,
    pushToast,
    setProviders,
    setIsFetchingModels,
    persistProviders: providerActions.persistProviders,
    reloadProviders: providerActions.reloadProviders,
  });

  /**
   * After a stored credential is removed the merged registry has to be re-READ
   * rather than patched: the provider may drop out of the list entirely, and a
   * local edit would leave a row the next load deletes anyway.
   */
  const handleSignedOut = async (message: string) => {
    setIsLogoutModalOpen(false);
    pushToast(message, 'success');
    await providerActions.reloadProviders();
  };

  const handleModelAdded = async (modelId: string) => {
    pushToast(`${modelId} registered in models.yml.`, 'success');
    await providerActions.reloadProviders();
  };

  return {
    providers,
    availablePresetProviders,
    existingSlugs,
    selectedProvider,
    catalogError,
    isLoading,
    isFetchingModels,
    toasts,
    pushToast,
    dismissToast,
    isAddModelModalOpen,
    setIsAddModelModalOpen,
    handleModelAdded,
    handleSignedOut,
    isDeleteModalOpen,
    setIsDeleteModalOpen,
    isLogoutModalOpen,
    setIsLogoutModalOpen,
    isDeletingProvider,
    isAddModalOpen,
    setIsAddModalOpen,
    isEntryModalOpen,
    setIsEntryModalOpen,
    isLoginModalOpen,
    setIsLoginModalOpen,
    configModel,
    setConfigModel,
    capabilitiesModel,
    setCapabilitiesModel,
    setSelectedProviderId,
    ...providerActions,
    ...modelActions,
  };
}
