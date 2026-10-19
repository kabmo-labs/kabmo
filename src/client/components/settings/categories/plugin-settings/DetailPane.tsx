import { useEffect, useState } from 'preact/hooks';
import { ExternalLink, RotateCcw, Trash2 } from 'lucide-preact';
import type { PluginFeatureSpec, PluginItem } from '@/shared/types';
import { PluginSettingsSection } from '@/client/components/settings/categories/plugin-settings/SettingsSection';

interface PluginDetailPaneProps {
  plugin: PluginItem | null;
  busy: string | null;
  onToggleEnabled: (plugin: PluginItem, enabled: boolean) => void;
  onUpgrade: (plugin: PluginItem) => void;
  onUninstall: (plugin: PluginItem) => void;
  onSaveFeatures: (plugin: PluginItem, features: string[]) => void;
  onSaveSetting: (plugin: PluginItem, key: string, value: string) => void;
  onDeleteSetting: (plugin: PluginItem, key: string) => void;
}

/**
 * One plugin: identity, enable/upgrade/remove, features, and settings.
 *
 * The same plugin id can exist in BOTH scopes, and the scope is what each
 * action names — a bare "Disable" would not say which install it touches, and
 * removing a project install leaves a user install of the same plugin in place.
 * The remove action is therefore the only one that asks first, and its wording
 * says which copy goes.
 */
export function PluginDetailPane({
  plugin,
  busy,
  onToggleEnabled,
  onUpgrade,
  onUninstall,
  onSaveFeatures,
  onSaveSetting,
  onDeleteSetting,
}: PluginDetailPaneProps) {
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  useEffect(() => setConfirmingRemove(false), [plugin?.id, plugin?.scope]);

  if (!plugin) {
    return (
      <div className="flex-1 flex flex-col h-full items-center justify-center px-8 text-center bg-paper">
        <p className="text-xs text-ink/50 leading-relaxed max-w-sm">
          Select a plugin to see its manifest, features and settings. Plugins are installed through
          {' '}<span className="font-mono text-ink/70">omp plugin</span>, so omp loads exactly what this panel
          lists.
        </p>
      </div>
    );
  }

  const isBusy = busy !== null;
  const scopeLabel = plugin.scope === 'project' ? 'this workspace' : 'all projects';

  return (
    <div className="flex-1 flex flex-col h-full scrollbar-overlay-container bg-paper text-ink p-6 md:p-8 space-y-6">
      <div className="flex items-start justify-between gap-4 pb-4 border-b border-ink/10">
        <div className="min-w-0">
          <h2 className="text-sm font-bold tracking-tight text-ink truncate">{plugin.name}</h2>
          <p className="text-xs text-ink/60 mt-0.5 truncate">
            {plugin.version || 'no version'} · {plugin.scope === 'project' ? 'project scope' : 'user scope'}
            {plugin.marketplace ? ` · ${plugin.marketplace}` : ''}
          </p>
          {plugin.description && <p className="text-xs text-ink/70 mt-2 leading-relaxed">{plugin.description}</p>}
          {plugin.homepage && (
            <a
              href={plugin.homepage}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-1 inline-flex items-center gap-1 text-[11px] text-ink/60 hover:text-ink underline decoration-ink/30"
            >
              <ExternalLink size={11} /> {plugin.homepage}
            </a>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            type="button"
            disabled={isBusy}
            aria-pressed={plugin.enabled}
            onClick={() => onToggleEnabled(plugin, !plugin.enabled)}
            className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer disabled:opacity-50 ${
              plugin.enabled
                ? 'border-ink/20 text-ink/70 hover:bg-ink/5'
                : 'border-ink bg-ink text-paper hover:bg-ink/90'
            }`}
          >
            {plugin.enabled ? 'Disable' : 'Enable'}
          </button>
          {plugin.updateAvailable && (
            <button
              type="button"
              disabled={isBusy}
              onClick={() => onUpgrade(plugin)}
              className="px-3 py-1.5 rounded-lg border border-amber-500/40 text-xs font-medium text-ink hover:bg-amber-500/10 transition-colors cursor-pointer disabled:opacity-50"
            >
              Upgrade to {plugin.updateAvailable}
            </button>
          )}
        </div>
      </div>

      {plugin.shadowedBy === 'project' && (
        <div className="rounded-lg border border-ink/15 bg-ink/5 px-3 py-2 text-[11px] text-ink/70 leading-relaxed">
          A project install of this plugin in this workspace takes precedence, so this user copy is not the one
          loading right now. Disabling or removing it leaves the project copy in place.
        </div>
      )}

      {plugin.installPath && (
        <section className="space-y-1">
          <h3 className="text-xs font-bold uppercase tracking-wider text-ink">Install location</h3>
          <p className="text-[11px] font-mono text-ink/70 break-all">{plugin.installPath}</p>
        </section>
      )}

      {plugin.features.length > 0 ? (
        <FeaturesSection
          features={plugin.features}
          selected={plugin.enabledFeatures}
          disabled={isBusy}
          note={plugin.featuresNote}
          onSave={(features) => onSaveFeatures(plugin, features)}
        />
      ) : (
        <section className="space-y-1">
          <h3 className="text-xs font-bold uppercase tracking-wider text-ink">Features</h3>
          <p className="text-[11px] text-ink/50 leading-relaxed">
            This plugin declares no optional features. It loads its whole content (skills, commands, hooks, MCP
            servers) whenever it is enabled.
          </p>
        </section>
      )}

      {plugin.settings.length > 0 && (
        <PluginSettingsSection
          plugin={plugin}
          disabled={isBusy}
          onSave={onSaveSetting}
          onDelete={onDeleteSetting}
        />
      )}

      <div className="pt-4 border-t border-ink/10 flex items-center justify-between gap-3">
        <p className="text-[11px] text-ink/50 leading-snug max-w-sm">
          Uninstalling removes the plugin and its stored settings from {scopeLabel}.
        </p>
        {confirmingRemove ? (
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              type="button"
              disabled={isBusy}
              onClick={() => onUninstall(plugin)}
              className="px-3.5 py-2 rounded-lg border border-error text-error text-xs font-medium hover:bg-error/5 transition-colors cursor-pointer disabled:opacity-50"
            >
              Confirm remove
            </button>
            <button
              type="button"
              onClick={() => setConfirmingRemove(false)}
              className="px-3 py-2 rounded-lg text-xs text-ink/60 hover:text-ink cursor-pointer"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingRemove(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-ink/20 hover:border-error hover:text-error text-ink/70 text-xs font-medium transition-colors cursor-pointer flex-shrink-0"
          >
            <Trash2 size={14} />
            <span>Uninstall</span>
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The feature ladder, saved as ONE selection.
 *
 * omp's own `--enable`/`--disable` can only add and remove, so a plugin that
 * started with features on could never be returned to its defaults. The pane
 * edits a local selection and saves the whole list through `--set`, the only
 * shape that can express "none"; `selected === null` means omp is applying the
 * features marked `default`, which is why the draft starts from those.
 */
function FeaturesSection({
  features,
  selected,
  disabled,
  note,
  onSave,
}: {
  features: PluginFeatureSpec[];
  selected: string[] | null;
  disabled: boolean;
  note?: string;
  onSave: (features: string[]) => void;
}) {
  const effective = selected ?? features.filter((feature) => feature.isDefault).map((feature) => feature.name);
  const [draft, setDraft] = useState<string[]>(effective);

  useEffect(() => setDraft(effective), [selected, features]);

  const dirty = draft.length !== effective.length || draft.some((name) => !effective.includes(name));

  return (
    <section className="space-y-2 pt-2 border-t border-ink/10">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-ink">Features</h3>
          <p className="text-[11px] text-ink/50 mt-0.5">
            {selected === null
              ? 'Using omp’s defaults (the features marked default).'
              : 'Explicit selection stored in omp-plugins.lock.json.'}
          </p>
        </div>
        {/* A read-only ladder still SHOWS the selection — the list is the truth
            of what loads — it just cannot be saved through Kabmo. */}
        {!note && (
          <div className="flex items-center gap-2">
            {selected !== null && (
              <button
                type="button"
                disabled={disabled}
                onClick={() => onSave([])}
                title="Clear the explicit selection so omp uses its defaults"
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-ink/20 text-[11px] text-ink/70 hover:text-ink hover:bg-ink/5 transition-colors cursor-pointer disabled:opacity-50"
              >
                <RotateCcw size={12} /> Defaults
              </button>
            )}
            <button
              type="button"
              disabled={disabled || !dirty}
              onClick={() => onSave(draft)}
              className="px-3 py-1.5 rounded-lg bg-ink text-paper text-[11px] font-medium hover:bg-ink/90 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Save features
            </button>
          </div>
        )}
      </div>

      {note && (
        <div className="rounded-lg border border-ink/15 bg-ink/5 px-3 py-2 text-[11px] text-ink/70 leading-relaxed">
          {note}
        </div>
      )}

      <div className="rounded-lg border border-ink/10 divide-y divide-ink/5">
        {features.map((feature) => (
          <label
            key={feature.name}
            className={`flex items-start gap-2 px-3 py-2 select-none ${note ? '' : 'cursor-pointer'}`}
          >
            <input
              type="checkbox"
              checked={draft.includes(feature.name)}
              disabled={disabled || Boolean(note)}
              onChange={(event) =>
                setDraft((prev) =>
                  event.currentTarget.checked
                    ? [...prev, feature.name]
                    : prev.filter((name) => name !== feature.name),
                )
              }
              className="mt-0.5 accent-ink cursor-pointer disabled:opacity-60"
            />
            <span className="min-w-0">
              <span className="text-xs font-medium text-ink font-mono">{feature.name}</span>
              {feature.isDefault && <span className="ml-1.5 text-[10px] text-ink/45">default</span>}
              {feature.description && (
                <span className="block text-[11px] text-ink/60 leading-snug">{feature.description}</span>
              )}
            </span>
          </label>
        ))}
      </div>
    </section>
  );
}
