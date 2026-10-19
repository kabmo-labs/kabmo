import { AlertTriangle, Trash2, X } from 'lucide-preact';
import type { PanelPluginError } from '@/shared/types';
import {
  refreshPanelRegistry,
  usePanelPluginActions,
  usePanelRegistry,
  usePanelSlots,
} from '@/client/hooks/workspace/panel-registry';
import { InstallForm } from '@/client/components/settings/categories/panel-plugins/InstallForm';
import { AvailableList } from '@/client/components/settings/categories/panel-plugins/AvailableList';
import { InstalledList } from '@/client/components/settings/categories/panel-plugins/InstalledList';
import { BuiltinList } from '@/client/components/settings/categories/panel-plugins/BuiltinList';
import { PluginToolbar } from '@/client/components/settings/categories/panel-plugins/Toolbar';
import { SyncBlockedNotice } from '@/client/components/settings/categories/panel-plugins/SyncBlockedNotice';

/**
 * One rejection, with the repair it has when there is one.
 *
 * The only rejection a user can act on is a catalog entry whose directory is
 * gone, and the server marks exactly that row by carrying its `source` — the
 * other rejections (a manifest that will not parse, a catalog that is not JSON)
 * name a fault the user has to fix in the file, and offering a button that
 * deleted the record would hide the fault rather than fix it. A directory that
 * is already absent is the one case where dropping the record IS the fix.
 */
function RejectionRow({
  error,
  busy,
  onForget,
}: {
  error: PanelPluginError;
  busy: boolean;
  onForget: (source: string) => Promise<boolean>;
}) {
  const source = error.source;
  return (
    <div className="border border-error/30 rounded p-3">
      <div className="flex items-center gap-2 text-error">
        <AlertTriangle size={14} className="flex-shrink-0" />
        <span className="text-xs">Rejected</span>
      </div>
      <div className="mt-1 text-[11px] font-mono text-ink/50 break-all">{error.dir}</div>
      <div className="mt-1 text-xs text-ink/70">{error.reason}</div>
      {source ? (
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void onForget(source)}
            className="flex items-center gap-1.5 px-2 py-1 text-[11px] rounded border border-error/40 text-error hover:bg-error/10 disabled:opacity-50"
            title={`Drop the catalog entry "${source}" — the directory it names is already gone`}
          >
            <Trash2 size={12} />
            Forget this entry
          </button>
          <span className="text-[11px] text-ink/45">
            Removes the record from marketplace.json. No files are touched.
          </span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The panel-plugin marketplace: what is available, what is installed, and how
 * to change either.
 *
 * Three lists, and the split between them is the feature. **Available** is the
 * bundled marketplace — a STORE, so a plugin the package ships is an offer and
 * nothing more until the user installs it (VS Code's model). **Installed** is
 * what is on disk, each row carrying the switch that turns its contributions on
 * or off without deleting anything, and the slots its bundle registered.
 * Rejections are listed last, because a plugin that fails to load with no reason
 * reads as a plugin that was never installed — the single most confusing
 * failure this surface can have.
 *
 * The installed rows come from the INSTALLED list rather than from the
 * registrations: a plugin that is switched off publishes no component, so a
 * registration-derived list would drop the row the user needs to switch it back
 * on.
 */
export function PanelPluginsSection() {
  const { panels, errors, plugins, catalog, disabledPanels, gitStatus, autoUpdate, syncBlocked, ready } =
    usePanelRegistry();
  const { slots, failures } = usePanelSlots();
  const actions = usePanelPluginActions();

  const refresh = () => void refreshPanelRegistry();

  const available = catalog.filter((entry) => !entry.installed);
  const failureMap = new Map(failures.map((failure) => [failure.pluginId, failure.reason]));
  // An installed plugin's icon and README, for the card. Both come from the
  // registry rather than from the manifest, because the URLs are
  // content-addressed server-side.
  const iconUrls = new Map(panels.map((panel) => [panel.pluginId, panel.iconUrl]));
  const readmeUrls = new Map(panels.map((panel) => [panel.pluginId, panel.readmeUrl]));
  const gitCount = plugins.filter((plugin) => plugin.gitOrigin).length;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-ink/60 max-w-xl">
          Panels bundled with Kabmo, plus the ones you install from a git URL. A plugin is local code Kabmo loads into this page and renders in its own tree, so it looks and behaves like the rest of the
          app — treat it the way you would a VS Code extension.
        </p>
      </div>

      <PluginToolbar
        autoUpdate={autoUpdate}
        busy={actions.busy}
        gitCount={gitCount}
        onSetAutoUpdate={actions.setAutoUpdate}
        onCheckUpdates={actions.checkUpdates}
        onRefresh={refresh}
      />

      {actions.error ? (
        <div className="flex items-start gap-1.5 px-3 py-2 rounded-lg border border-error/30 bg-error/5 text-[11px] text-error leading-snug">
          <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
          <span className="flex-1 break-words">{actions.error}</span>
          <button type="button" onClick={actions.clearError} aria-label="Dismiss" className="cursor-pointer">
            <X size={12} />
          </button>
        </div>
      ) : null}

      <InstallForm
        busy={actions.busy === 'install'}
        onInstall={actions.install}
        onClearError={actions.clearError}
      />

      {!ready ? <p className="text-xs text-ink/50">Reading…</p> : null}

      {/* Built-ins first, and always — they are Kabmo's own views, so
          they are listed whether or not the registry read settled. */}
      <BuiltinList disabled={disabledPanels} busy={actions.busy} onSetEnabled={actions.setEnabled} />

      {ready && available.length === 0 && plugins.length === 0 && errors.length === 0 ? (
        <div className="text-xs text-ink/60 space-y-1.5">
          <p>No panel plugins installed.</p>
          <p className="font-mono text-[11px] text-ink/45 leading-relaxed">
            ~/.kabmo/marketplace/marketplace.json
            <br />
            ~/.kabmo/marketplace/plugins/&lt;plugin&gt;/package.json
          </p>
        </div>
      ) : null}

      <AvailableList entries={available} busy={actions.busy} onInstall={actions.installBundled} />

      {/* A blocked bundled update, above the list it explains: the plugin is in
          the Installed grid below, and a notice underneath it would be read after
          the row it is about. */}
      <SyncBlockedNotice blocked={syncBlocked} busy={actions.busy} onForceSync={actions.forceSync} />

      {plugins.length > 0 ? (
        <InstalledList
          plugins={plugins}
          slots={slots}
          failures={failureMap}
          iconUrls={iconUrls}
          readmeUrls={readmeUrls}
          busy={actions.busy}
          onBuild={actions.build}
          onRemove={actions.remove}
          onSetEnabled={actions.setEnabled}
          gitStatus={gitStatus}
          onUpdateGit={actions.updateGit}
        />
      ) : null}

      {errors.map((error) => (
        <RejectionRow
          key={error.dir + error.reason}
          error={error}
          busy={actions.busy !== null}
          onForget={actions.forget}
        />
      ))}
    </div>
  );
}
