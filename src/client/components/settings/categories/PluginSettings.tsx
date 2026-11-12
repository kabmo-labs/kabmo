import { useState } from 'preact/hooks';
import type { PluginItem } from '@/shared/types';
import { PluginSidebarList, type PluginView } from '@/client/components/settings/categories/plugin-settings/SidebarList';
import { PluginDetailPane } from '@/client/components/settings/categories/plugin-settings/DetailPane';
import { PluginMarketplacePane } from '@/client/components/settings/categories/plugin-settings/MarketplacePane';
import { pluginSelectionKey } from '@/client/components/settings/categories/plugin-settings/selection';
import { LoadingState } from '@/client/components/settings/LoadingState';
import { useSettingsMasterDetail } from '@/client/hooks/settings/master-detail';
import { SettingsMasterDetail } from '@/client/components/settings/master-detail';
import { GLOBAL_SCOPE_ID, useWorkspaceRoots } from '@/client/hooks/settings/workspace-roots';
import { pluginScopeBody, usePluginSettings } from '@/client/hooks/settings/plugins';

/**
 * The Plugins panel, scoped to one omp scope at a time.
 *
 * The scope picker decides which directory `omp plugin` runs in, and that is
 * not a filter: omp reads the PROJECT registry of its cwd, so a workspace scope
 * lists that workspace's project installs beside the user ones while the user
 * scope (cwd = `$HOME`, which omp deliberately does not treat as a project
 * anchor) lists only the user's. Every action carries the plugin's OWN scope,
 * because a user install shadowed by a project one is still actionable as the
 * user install — `--scope user` is what tells omp which of the two to touch.
 *
 * Two views, because a marketplace is a different noun from an installed
 * plugin: it has no features, no settings and no enable flag, and its actions
 * (update catalog, remove) are not per-plugin.
 */
export function PluginSettings() {
  const masterDetail = useSettingsMasterDetail();
  const roots = useWorkspaceRoots();
  const [selectedRootId, setSelectedRootId] = useState<string>(GLOBAL_SCOPE_ID);
  const [view, setView] = useState<PluginView>('installed');
  const [selectedPluginKey, setSelectedPluginKey] = useState<string | null>(null);

  const workspace = roots.rootFor(selectedRootId);
  const data = usePluginSettings(roots.queryFor(selectedRootId));
  // A plugin id is not unique: the same `name@marketplace` can be installed in
  // BOTH scopes, and the two copies differ in version, enablement and shadowing.
  // The selection is therefore the (id, scope) pair, which is what the row
  // carries and what every action names.
  const selectedPlugin =
    data.plugins.find((plugin) => pluginSelectionKey(plugin) === selectedPluginKey) ?? null;

  if (data.isLoading) {
    return <LoadingState>Loading plugins…</LoadingState>;
  }

  const scopeFor = (plugin: PluginItem) => pluginScopeBody(plugin, workspace);

  return (
    <div className="flex-1 flex flex-col h-full w-full overflow-hidden bg-paper">
      <SettingsMasterDetail
        pane={masterDetail.pane}
        onBack={masterDetail.back}
        listLabel="Plugins"
        list={
          <PluginSidebarList
            plugins={data.plugins}
            marketplaces={data.marketplaces}
            catalogCount={data.catalog.length}
            view={view}
            onSelectView={(next) => {
              setView(next);
              masterDetail.openDetail();
            }}
            selectedPluginKey={selectedPluginKey}
            onSelectPlugin={(key) => {
              setSelectedPluginKey(key);
              masterDetail.openDetail();
            }}
            selectedProject={selectedRootId}
            onSelectProject={(next) => {
              setSelectedRootId(next);
              setSelectedPluginKey(null);
            }}
            projectOptions={roots.options}
            isWorkspaceScope={workspace !== null}
            busy={data.busy}
            error={data.error}
            onClearError={data.clearError}
            onInstall={(spec) => {
              void data.run(`Installing ${spec}`, { type: 'install', spec, ...scopeArgs(workspace) });
            }}
            onRefresh={() => data.refresh()}
          />
        }
        detail={
          view === 'marketplaces' ? (
            <PluginMarketplacePane
              marketplaces={data.marketplaces}
              catalog={data.catalog}
              plugins={data.plugins}
              busy={data.busy}
              error={data.error}
              onClearError={data.clearError}
              workspace={workspace}
              run={data.run}
            />
          ) : (
            <PluginDetailPane
              plugin={selectedPlugin}
              busy={data.busy}
              onToggleEnabled={(plugin, enabled) => {
                void data.run(`${enabled ? 'Enabling' : 'Disabling'} ${plugin.name}`, {
                  type: 'set_enabled',
                  id: plugin.id,
                  enabled,
                  ...scopeFor(plugin),
                });
              }}
              onUpgrade={(plugin) => {
                void data.run(`Upgrading ${plugin.name}`, {
                  type: 'upgrade',
                  id: plugin.id,
                  ...scopeFor(plugin),
                });
              }}
              onUninstall={(plugin) => {
                void data.run(`Uninstalling ${plugin.name}`, {
                  type: 'uninstall',
                  id: plugin.id,
                  ...scopeFor(plugin),
                });
              }}
              onSaveFeatures={(plugin, features) => {
                void data.run(`Saving features for ${plugin.name}`, {
                  type: 'set_features',
                  packageName: plugin.packageName,
                  pluginScope: plugin.scope,
                  features,
                  ...scopeArgs(workspace),
                });
              }}
              onSaveSetting={(plugin, key, value) => {
                void data.run(`Saving ${key}`, {
                  type: 'set_setting',
                  packageName: plugin.packageName,
                  key,
                  value,
                  ...scopeArgs(workspace),
                });
              }}
              onDeleteSetting={(plugin, key) => {
                void data.run(`Clearing ${key}`, {
                  type: 'delete_setting',
                  packageName: plugin.packageName,
                  key,
                  ...scopeArgs(workspace),
                });
              }}
            />
          )
        }
      />
    </div>
  );
}

/** Features and settings are addressed by package name, in the panel's scope. */
function scopeArgs(workspace: string | null): Record<string, unknown> {
  return workspace ? { root: workspace } : { scope: 'user' };
}
