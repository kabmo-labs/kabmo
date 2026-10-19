import { ToastStack } from '@/client/components/common/ToastStack';
import { useProviderSettings } from '@/client/hooks/settings/providers';
import { ProviderSidebarList } from '@/client/components/settings/categories/provider-settings/SidebarList';
import { ProviderHeader } from '@/client/components/settings/categories/provider-settings/Header';
import { ProviderAuthSection } from '@/client/components/settings/categories/provider-settings/AuthSection';
import { ProviderModelsList } from '@/client/components/settings/categories/provider-settings/ModelsList';
import { AddProviderModal } from '@/client/components/settings/categories/provider-settings/AddProviderModal';
import { ReconnectModal } from '@/client/components/settings/categories/provider-settings/ReconnectModal';
import { LoginModal } from '@/client/components/settings/categories/provider-settings/LoginModal';
import { ModelConfigModal } from '@/client/components/settings/categories/provider-settings/ModelConfigModal';
import { ModelCapabilitiesModal } from '@/client/components/settings/categories/provider-settings/ModelCapabilitiesModal';
import { AddModelModal } from '@/client/components/settings/categories/provider-settings/AddModelModal';
import { DeleteProviderModal } from '@/client/components/settings/categories/provider-settings/DeleteProviderModal';
import { LogoutProviderModal } from '@/client/components/settings/categories/provider-settings/LogoutProviderModal';
import { providerEmptyReason, providerFetchBlockReason } from '@/shared/lib/models/provider/dialect';
import { configuredProviderSlugs } from '@/shared/lib/models/provider/presets';
import { useSettingsMasterDetail } from '@/client/hooks/settings/master-detail';
import { SettingsMasterDetail } from '@/client/components/settings/master-detail';

interface ProviderSettingsProps {
  autoOpenAdd?: boolean;
  onAddModalClose?: () => void;
}

export function ProviderSettings({
  autoOpenAdd = false,
  onAddModalClose,
}: ProviderSettingsProps) {
  const masterDetail = useSettingsMasterDetail();
  const {
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
    handleDeleteProvider,
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
    handleAddProvider,
    handleReconnect,
    handleFetchModels,
    handleFetchModelsFromList,
    handleOmpAuthSuccess,
    handleToggleDisconnect,
    handleToggleProviderDisabled,
    handleHideAll,
    handleShowAll,
    handleToggleModelVisibility,
    handleSaveModelConfig,
  } = useProviderSettings({ autoOpenAdd, onAddModalClose });

  return (
    <div className="w-full h-full flex flex-col overflow-hidden bg-paper text-ink">
      <SettingsMasterDetail
        // The "add provider" dialog lives inside the detail pane, so a hidden
        // pane would hide the dialog with it — and `autoOpenAdd` (the model
        // dropdown's "no provider configured" path) opens it without any row
        // having been tapped. While that dialog is open the pane stays up.
        pane={isAddModalOpen ? 'detail' : masterDetail.pane}
        onBack={masterDetail.back}
        listLabel="Providers"
        list={
          <ProviderSidebarList
            providers={connectedProviders}
            selectedProviderId={selectedProvider?.id || ''}
            onSelectProvider={(id) => {
              setSelectedProviderId(id);
              masterDetail.openDetail();
            }}
            onOpenAddModal={() => setIsAddModalOpen(true)}
            currentProject={currentProject}
            onSelectProject={setCurrentProject}
          />
        }
        detail={
          <div className="flex-1 scrollbar-overlay-container p-6 md:p-8 space-y-6">
            {selectedProvider ? (
              <>
                <ProviderHeader provider={selectedProvider} />

                <ProviderAuthSection
                  provider={selectedProvider}
                  onOpenReconnectModal={() => {
                    // A provider omp signs in through `/login` needs the OAuth
                    // dialog; one whose endpoint and key live in models.yml (or the
                    // Kabmo overlay) is edited in place. Testing the provider ID
                    // for `omp-auth-` was wrong: a native models.yml entry shares
                    // that ID prefix once merged, and a keyless local server has no
                    // login flow to complete at all.
                    if (selectedProvider.credentialSource === 'omp-auth' && selectedProvider.auth !== 'none') {
                      setIsLoginModalOpen(true);
                    } else {
                      setIsReconnectModalOpen(true);
                    }
                  }}
                  onToggleDisconnect={handleToggleDisconnect}
                  onToggleDisabled={handleToggleProviderDisabled}
                  onDelete={() => setIsDeleteModalOpen(true)}
                  onSignOut={() => setIsLogoutModalOpen(true)}
                />

                <ProviderModelsList
                  models={selectedProvider.models}
                  emptyReason={providerEmptyReason(selectedProvider)}
                  onToggleModelVisibility={handleToggleModelVisibility}
                  onHideAll={handleHideAll}
                  onShowAll={handleShowAll}
                  onFetchModels={handleFetchModelsFromList}
                  onAddModel={() => setIsAddModelModalOpen(true)}
                  fetchBlockReason={providerFetchBlockReason(selectedProvider)}
                  isFetchingModels={isFetchingModels}
                  onOpenModelConfig={(model) => setConfigModel(model)}
                  onOpenModelCapabilities={(model) => setCapabilitiesModel(model)}
                />
              </>
            ) : (
              <div className="py-12 text-center text-xs text-ink/40">
                Select a provider from the sidebar to view connection details
              </div>
            )}
          </div>
        }
      />

      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      <AddProviderModal
        isOpen={isAddModalOpen}
        onClose={() => {
          setIsAddModalOpen(false);
          onAddModalClose?.();
        }}
        onAddProvider={async (provider, options) => {
          await handleAddProvider(provider, options);
          // The row now exists in the list; on a phone the newly registered
          // provider is what the user came to configure, so land on its detail
          // rather than dropping them back on the list.
          masterDetail.openDetail();
        }}
        presets={availablePresetProviders}
        existingSlugs={configuredProviderSlugs(providers)}
      />

      {selectedProvider && (
        <ReconnectModal
          isOpen={isReconnectModalOpen}
          provider={selectedProvider}
          isFetchingModels={isFetchingModels}
          onClose={() => setIsReconnectModalOpen(false)}
          onReconnect={handleReconnect}
          onFetchModels={handleFetchModels}
        />
      )}

      {selectedProvider && (
        <LoginModal
          isOpen={isLoginModalOpen}
          provider={selectedProvider}
          onClose={() => setIsLoginModalOpen(false)}
          onAuthenticated={handleOmpAuthSuccess}
        />
      )}

      {selectedProvider && (
        <AddModelModal
          isOpen={isAddModelModalOpen}
          provider={selectedProvider}
          onClose={() => setIsAddModelModalOpen(false)}
          onAdded={(modelId) => void handleModelAdded(modelId)}
          onError={(message) => pushToast(message, 'error')}
        />
      )}

      <LogoutProviderModal
        isOpen={isLogoutModalOpen}
        provider={selectedProvider ?? null}
        onClose={() => setIsLogoutModalOpen(false)}
        onSignedOut={(message) => void handleSignedOut(message)}
      />

      <DeleteProviderModal
        isOpen={isDeleteModalOpen}
        provider={selectedProvider ?? null}
        isDeleting={isDeletingProvider}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={() => void handleDeleteProvider()}
      />

      <ModelConfigModal
        isOpen={!!configModel}
        model={configModel}
        onClose={() => setConfigModel(null)}
        onSaveModelConfig={handleSaveModelConfig}
      />
      <ModelCapabilitiesModal
        isOpen={!!capabilitiesModel}
        model={capabilitiesModel}
        onClose={() => setCapabilitiesModel(null)}
      />
    </div>
  );
}
