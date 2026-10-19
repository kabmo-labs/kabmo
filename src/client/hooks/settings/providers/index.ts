import { useEffect, useMemo, useState } from 'preact/hooks';
import type { PresetProviderOption, ProviderItem, ProviderModel } from '@/shared/types';
import { PRESET_NEW_PROVIDERS } from '@/client/data/settings/provider';
import { buildAvailableProviderPresets } from '@/shared/lib/models/provider/presets';
import { useToasts } from '@/client/hooks/ui/toasts';
import { loadProvidersFromApi } from '@/client/hooks/settings/providers/api';
import { createProviderActions } from '@/client/hooks/settings/providers/actions';

interface UseProviderSettingsOptions {
  autoOpenAdd?: boolean;
  onAddModalClose?: () => void;
}

/**
 * State wiring behind Settings → Providers.
 *
 * The mutations themselves live in `providers/actions.ts`, which receives this
 * hook's setters as one `deps` record — the split keeps both files under the
 * repo's size ceiling without changing closure semantics, since every action
 * still closes over the same state.
 *
 * Every mutation lands in one of two stores: Kabmo-local overlay (per-model
 * visibility and sampling config) or omp's own config.yml `disabledProviders`
 * (connect / disconnect). Disconnect has to use the latter — the overlay is
 * re-merged away on load, which is why a disconnected provider used to come back
 * as connected.
 */
export function useProviderSettings({
  autoOpenAdd = false,
  onAddModalClose,
}: UseProviderSettingsOptions = {}) {
  const [providers, setProviders] = useState<ProviderItem[]>([]);
  const [presetProviders, setPresetProviders] = useState<PresetProviderOption[]>(PRESET_NEW_PROVIDERS);
  const [selectedProviderId, setSelectedProviderId] = useState<string>('provider-deepseek');
  const [currentProject, setCurrentProject] = useState('kabmo');
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const { toasts, pushToast, dismissToast } = useToasts();

  const [isAddModalOpen, setIsAddModalOpen] = useState(autoOpenAdd);
  const [isAddModelModalOpen, setIsAddModelModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);
  const [isDeletingProvider, setIsDeletingProvider] = useState(false);
  const [isReconnectModalOpen, setIsReconnectModalOpen] = useState(false);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [configModel, setConfigModel] = useState<ProviderModel | null>(null);
  const [capabilitiesModel, setCapabilitiesModel] = useState<ProviderModel | null>(null);

  useEffect(() => {
    if (autoOpenAdd) setIsAddModalOpen(true);
  }, [autoOpenAdd]);

  useEffect(() => {
    let active = true;
    void loadProvidersFromApi().then((data) => {
      if (!active || !data) return;
      setProviders(data.providers);
      const connected = data.providers.filter((provider) => provider.status === 'connected');
      setSelectedProviderId(connected.length > 0 ? connected[0].id : '');
      if (data.presetProviders) setPresetProviders(data.presetProviders);
    });
    return () => { active = false; };
  }, []);

  // The sidebar lists connected providers plus every provider the user disabled:
  // a disabled provider reports `disconnected`, so filtering on status alone
  // would make the switch that hid it unreachable.
  const connectedProviders = useMemo(
    () => providers.filter(
      (provider) => provider.status === 'connected' || provider.disabled === true,
    ),
    [providers],
  );
  const availablePresetProviders = useMemo(
    () => buildAvailableProviderPresets(providers, presetProviders),
    [providers, presetProviders],
  );
  const selectedProvider = connectedProviders.find((p) => p.id === selectedProviderId) || connectedProviders[0];

  const actions = createProviderActions({
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
    ...(onAddModalClose ? { onAddModalClose } : {}),
  });

  /**
   * After a hand-registered model lands in models.yml, the registry has to be
   * re-read: the new row exists only in omp's file, so nothing in Kabmo's
   * own overlay knows about it yet. Re-fetching the MERGED list (rather than
   * re-saving the overlay, whose response is the overlay alone) is what puts
   * the model in the sidebar count and the chat picker.
   */
  /**
   * After a stored credential is removed the merged registry has to be re-READ
   * rather than patched: the provider may drop out of the list entirely, and a
   * local edit would leave a row the next load deletes anyway.
   */
  const handleSignedOut = async (message: string) => {
    setIsLogoutModalOpen(false);
    pushToast(message, 'success');
    const data = await loadProvidersFromApi();
    if (data) setProviders(data.providers);
  };

  const handleModelAdded = async (modelId: string) => {
    pushToast(`${modelId} registered in models.yml.`, 'success');
    const data = await loadProvidersFromApi();
    if (data) setProviders(data.providers);
  };

  return {
    providers,
    connectedProviders,
    availablePresetProviders,
    selectedProvider,
    currentProject,
    setCurrentProject,
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
    isReconnectModalOpen,
    setIsReconnectModalOpen,
    isLoginModalOpen,
    setIsLoginModalOpen,
    configModel,
    setConfigModel,
    capabilitiesModel,
    setCapabilitiesModel,
    setSelectedProviderId,
    ...actions,
  };
}
