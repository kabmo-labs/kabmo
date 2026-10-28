import { ToastStack } from '@/client/components/common/ToastStack';
import { useProviderSettings } from '@/client/hooks/settings/providers';
import { ProviderSidebarList } from '@/client/components/settings/categories/provider-settings/SidebarList';
import { ProviderHeader } from '@/client/components/settings/categories/provider-settings/Header';
import { ProviderAuthSection } from '@/client/components/settings/categories/provider-settings/AuthSection';
import { ProviderModelsList } from '@/client/components/settings/categories/provider-settings/ModelsList';
import { AddProviderModal } from '@/client/components/settings/categories/provider-settings/AddProviderModal';
import { ProviderEntryModal } from '@/client/components/settings/categories/provider-settings/EntryModal';
import { LoginModal } from '@/client/components/settings/categories/provider-settings/LoginModal';
import { ModelConfigModal } from '@/client/components/settings/categories/provider-settings/ModelConfigModal';
import { ModelCapabilitiesModal } from '@/client/components/settings/categories/provider-settings/ModelCapabilitiesModal';
import { AddModelModal } from '@/client/components/settings/categories/provider-settings/AddModelModal';
import { DeleteProviderModal } from '@/client/components/settings/categories/provider-settings/DeleteProviderModal';
import { LogoutProviderModal } from '@/client/components/settings/categories/provider-settings/LogoutProviderModal';
import { providerEmptyReason, providerFetchBlockReason } from '@/shared/lib/models/provider/dialect';
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
    handleAddProvider,
    handleConnect,
    handleEntrySaved,
    handleRefreshModels,
    handleFetchModels,
    handleOmpAuthSuccess,
    handleToggleProviderDisabled,
    handleDeleteProvider,
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
            providers={providers}
            selectedProviderId={selectedProvider?.id ?? ''}
            onSelectProvider={(id) => {
              setSelectedProviderId(id);
              masterDetail.openDetail();
            }}
            onOpenAddModal={() => setIsAddModalOpen(true)}
            onDeleteProvider={(provider) => {
              setSelectedProviderId(provider.id);
              setIsDeleteModalOpen(true);
            }}
            {...(catalogError ? { catalogError } : {})}
          />
        }
        detail={
          <div className="flex-1 scrollbar-overlay-container p-6 md:p-8 space-y-6">
            {selectedProvider ? (
              <>
                <ProviderHeader provider={selectedProvider} />

                <ProviderAuthSection
                  provider={selectedProvider}
                  onConnect={handleConnect}
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
                  onRefreshModels={handleRefreshModels}
                  onImportModels={handleFetchModels}
                  onAddModel={() => setIsAddModelModalOpen(true)}
                  fetchBlockReason={providerFetchBlockReason(selectedProvider)}
                  isFetchingModels={isFetchingModels}
                  onOpenModelConfig={(model) => setConfigModel(model)}
                  onOpenModelCapabilities={(model) => setCapabilitiesModel(model)}
                />
              </>
            ) : isLoading ? (
              <div className="py-12 text-center text-xs text-ink/40">Reading omp’s provider registry…</div>
            ) : (
              <div className="py-12 text-center text-xs text-ink/40 space-y-2">
                <p>omp reports no providers yet.</p>
                <p className="text-[11px] text-ink/35">
                  Sign in to a provider from the list, or add one with the plus button.
                </p>
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
        existingSlugs={existingSlugs}
      />

      {selectedProvider && (
        <ProviderEntryModal
          key={selectedProvider.id}
          isOpen={isEntryModalOpen}
          provider={selectedProvider}
          onClose={() => setIsEntryModalOpen(false)}
          onSaved={(changed: string[]) => void handleEntrySaved(changed)}
        />
      )}

      {selectedProvider && (
        <LoginModal
          isOpen={isLoginModalOpen}
          provider={selectedProvider}
          onClose={() => setIsLoginModalOpen(false)}
          onAuthenticated={() => void handleOmpAuthSuccess()}
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
