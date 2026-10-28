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
import { refreshProviderIcon } from '@/shared/lib/models/provider/connection';
import { subscribeModelsUpdated } from '@/shared/lib/models/client';

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
  const [isRefreshingList, setIsRefreshingList] = useState(false);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [isRefreshingIcon, setIsRefreshingIcon] = useState(false);
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

  /**
   * A provider's web icon is fetched in the BACKGROUND (the registry never makes
   * a request wait on a third-party host), and the server republishes the
   * `models` topic when it stored one. Without this subscription the icons
   * arrived only on the next manual open — the panel had already drawn its
   * initials fallbacks.
   *
   * Debounced: the pass stores several icons in a row, and each publish is one
   * full registry read.
   */
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeModelsUpdated(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void loadProvidersFromApi().then((data) => {
          if (data) setProviders(data.providers);
        });
      }, 400);
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
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

  /**
   * Refetch this provider's icon from its own site.
   *
   * Separate from the registry's background pass: that one only runs when the
   * stored icon is missing or older than a week, and this is the user saying
   * "look again now" after the site changed.
   */
  const handleRefreshIcon = async () => {
    const target = selectedProvider;
    if (!target || isRefreshingIcon) return;
    if (!target.baseUrl) {
      pushToast('This provider has no endpoint, so there is no site to read an icon from.', 'error');
      return;
    }
    setIsRefreshingIcon(true);
    try {
      const result = await refreshProviderIcon(target.slug, target.baseUrl);
      if (!result.ok) {
        pushToast(result.error || 'No usable icon on that host — keeping the current mark.', 'error');
        return;
      }
      const refreshed = await providerActions.reloadProviders();
      const next = refreshed.find((provider) => provider.slug === target.slug);
      if (next) setSelectedProviderId(next.id);
      pushToast(`${target.name}: icon updated from ${target.baseUrl}.`, 'success');
    } finally {
      setIsRefreshingIcon(false);
    }
  };

  /**
   * Re-read the merged provider list.
   *
   * The list is a snapshot of four sources (omp's login providers, models.yml,
   * config.yml's disabled set and the model catalog), and any of them can move
   * without this tab doing anything — a second instance, a hand edit of
   * models.yml, a login finished in another tab. The panel already re-reads on
   * the `models` signal; this is the explicit "now" for everything that signal
   * does not cover, and it is the only control that says what it did.
   *
   * The current selection SURVIVES when it still exists: a refresh that jumped
   * back to the first provider would throw away the row the user was reading.
   */
  const handleRefreshList = async () => {
    if (isRefreshingList) return;
    setIsRefreshingList(true);
    try {
      const data = await loadProvidersFromApi();
      if (!data) {
        pushToast('Could not read the provider list — omp may still be starting.', 'error');
        return;
      }
      setProviders(data.providers);
      setPresetProviders(data.presetProviders ?? []);
      setCatalogError(data.catalogError ?? null);
      setSelectedProviderId((current) => (
        data.providers.some((provider) => provider.id === current)
          ? current
          : (data.providers.find((provider) => provider.status === 'connected')?.id ?? data.providers[0]?.id ?? '')
      ));
      const count = data.providers.length;
      pushToast(
        `Provider list refreshed — ${count} provider${count === 1 ? '' : 's'}.`,
        'success',
      );
    } finally {
      setIsRefreshingList(false);
    }
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
    isRefreshingList,
    handleRefreshList,
    isFetchingModels,
    isRefreshingIcon,
    handleRefreshIcon,
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
