/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * OMP Engine settings panel — the complete native omp settings schema in
 * Kabmo modal.
 *
 * - Header: live engine state (running, model, thinking, context) + refresh.
 * - Config: every schema entry with UI metadata, rendered in omp's own
 *   tab/group layout, with search across ALL keys, condition gating (e.g.
 *   `mnemopi.*` only when `memory.backend === 'mnemopi'`), per-row
 *   reset-to-default, and persistence through /api/settings/omp-config
 *   (`omp config set` under the hood).
 * - Model Roles: role → model selector overrides (config.yml modelRoles).
 * - Extensions: `.omp/extensions` toggles.
 *
 * Every write resolves with the server's answer: the per-key state lives in
 * `useOmpConfigWrites`, and the panel keeps ONE problem banner for refusals
 * that have no row of their own (a failed load, a rejected extension toggle) so
 * they reach the screen instead of a console line.
 */

import { useCallback, useEffect, useState } from 'preact/hooks';
import { AlertCircle, Check, X } from 'lucide-preact';
import type { SettingsState } from '@/shared/types';
import type { ConfigEntry } from '@/server/lib/omp/config/config-cli';
import { OMP_SCHEMA } from '@/shared/lib/omp/config/schema';
import { ConfigTabs } from '@/client/components/settings/categories/omp-settings/ConfigTabs';
import { EngineHeader } from '@/client/components/settings/categories/omp-settings/EngineHeader';
import { RoleEditor } from '@/client/components/settings/categories/omp-settings/RoleEditor';
import { ExtensionsPanel } from '@/client/components/settings/categories/omp-settings/ExtensionsPanel';
import type {
  EngineState,
  ExtensionItem,
} from '@/client/components/settings/categories/omp-settings/types';
import { useModelRoles } from '@/client/hooks/settings/model-roles';
import { useOmpConfigWrites } from '@/client/hooks/settings/omp-config';

interface OmpSettingsProps {
  settings: SettingsState;
  onUpdate: (updater: Partial<SettingsState> | ((prev: SettingsState) => SettingsState)) => void;
}

/** A problem that has no config row of its own to sit under. */
interface PanelProblem {
  message: string;
  /** The thing it belongs to, so the same failure can clear itself. */
  scope?: string;
}

/** The read failure sentence of a payload, when it carries one. */
function payloadError(data: unknown): string | null {
  if (typeof data !== 'object' || data === null || !('error' in data)) return null;
  return typeof data.error === 'string' ? data.error : null;
}

export function OmpSettings(_props: OmpSettingsProps) {
  const [state, setState] = useState<EngineState | null>(null);
  const [stateRunning, setStateRunning] = useState(false);
  const [extensions, setExtensions] = useState<ExtensionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTabId, setActiveTabId] = useState(OMP_SCHEMA.tabs[0]?.id ?? 'appearance');
  const [searchQuery, setSearchQuery] = useState('');
  const [pendingExtensions, setPendingExtensions] = useState<Set<string>>(new Set());
  const [problem, setProblem] = useState<PanelProblem | null>(null);
  const [mounted, setMounted] = useState(true);

  useEffect(() => () => setMounted(false), []);

  const writes = useOmpConfigWrites();
  const { applyEntries, flashSaved, savedKey } = writes;

  // The role map, its presets and the role dropdowns' catalog. Its writes answer
  // with the server's whole map/list, so the panel never renders a guess.
  const modelRoles = useModelRoles(flashSaved);

  /**
   * Read the whole panel. `initial` keeps the full-screen spinner for the first
   * paint only: a refresh must not tear the panel down, or every open row loses
   * its editor state for a snapshot that arrives a second later.
   */
  const load = useCallback((initial: boolean) => {
    if (initial) setLoading(true);
    else setRefreshing(true);
    setLoadError(null);
    Promise.all([
      fetch('/api/omp/state').then((res) => res.json()),
      fetch('/api/settings/omp-config').then((res) => res.json()),
      fetch('/api/model-roles').then((res) => res.json()),
      fetch('/api/omp/extensions').then((res) => res.json()),
    ])
      .then(([stateData, configData, rolesData, extensionsData]) => {
        if (!mounted) return;
        if (stateData.running && stateData.state) setState(stateData.state as EngineState);
        else setState(null);
        setStateRunning(Boolean(stateData.running));
        const configFailure = payloadError(configData);
        if (configFailure) setLoadError(configFailure);
        else if (configData.entries) applyEntries(configData.entries as Record<string, ConfigEntry>);
        modelRoles.applyPayload(rolesData);
        const extensionFailure = payloadError(extensionsData);
        if (extensionFailure) setProblem({ message: extensionFailure });
        else if (Array.isArray(extensionsData.extensions)) setExtensions(extensionsData.extensions as ExtensionItem[]);
        setUpdatedAt(Date.now());
      })
      .catch((err) => {
        console.error('Failed to load omp settings:', err);
        if (!mounted) return;
        setLoadError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!mounted) return;
        setLoading(false);
        setRefreshing(false);
      });
  }, [applyEntries, modelRoles.applyPayload, mounted]);

  useEffect(() => { load(true); }, [load]);

  /**
   * Toggle one extension. The row owns its pending state and a refusal lands in
   * the panel's problem banner: the old code only logged, so a rejected write
   * left the row showing a state config.yml did not hold.
   */
  const handleToggleExtension = async (extension: ExtensionItem) => {
    const disabled = !extension.disabled;
    setPendingExtensions((prev) => new Set(prev).add(extension.id));
    try {
      const res = await fetch('/api/omp/extensions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: extension.id, disabled }),
      });
      const data: unknown = await res.json().catch(() => null);
      const error = payloadError(data) ?? (res.ok ? null : `The toggle answered ${res.status}`);
      const scope = `ext-${extension.id}`;
      if (error) {
        setProblem({ message: error, scope });
        return;
      }
      setExtensions((prev) => prev.map((item) => (
        item.id === extension.id ? { ...item, disabled } : item
      )));
      setProblem((current) => (current?.scope === scope ? null : current));
      flashSaved(scope);
    } catch (err) {
      console.error('Failed to toggle extension:', err);
      setProblem({
        message: err instanceof Error ? err.message : String(err),
        scope: `ext-${extension.id}`,
      });
    } finally {
      setPendingExtensions((prev) => {
        const next = new Set(prev);
        next.delete(extension.id);
        return next;
      });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8 text-ink/40 text-xs">
        Reading omp’s state, config schema and extensions…
      </div>
    );
  }

  return (
    <div className="w-full space-y-4 text-ink pb-2 text-xs">
      <EngineHeader
        running={stateRunning}
        state={state}
        refreshing={refreshing}
        updatedAt={updatedAt}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onRefresh={() => load(false)}
      />

      {loadError && (
        <div className="flex items-start gap-2 rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-[11px] text-error">
          <AlertCircle size={13} className="mt-px flex-shrink-0" />
          <span className="flex-1">
            omp’s config could not be read: {loadError}. The rows below cannot show what config.yml holds until this
            succeeds.
          </span>
          <button
            type="button"
            onClick={() => load(false)}
            className="flex shrink-0 items-center gap-1 rounded border border-error/40 px-2 py-0.5 font-medium hover:bg-error/10 cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {problem && (
        <div className="flex items-start gap-2 rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-[11px] text-error">
          <AlertCircle size={13} className="mt-px flex-shrink-0" />
          <span className="flex-1 break-words">{problem.message}</span>
          <button
            type="button"
            onClick={() => setProblem(null)}
            aria-label="Dismiss error"
            className="text-error/60 hover:text-error cursor-pointer"
          >
            <X size={12} />
          </button>
        </div>
      )}

      <div className="pt-1">
        <div className="flex items-center justify-between gap-3 pb-2">
          <div>
            <h3 className="text-sm font-semibold text-ink">Config</h3>
            <p className="text-ink/50 mt-0.5">
              Schema-driven settings backed by <span className="font-mono">omp config</span>.
              {searchQuery.trim() && ', matching keys only'}
            </p>
          </div>
          {savedKey && savedKey !== 'role-map' && !savedKey.startsWith('ext-') && (
            <span className="inline-flex shrink-0 items-center gap-1 text-[10px] text-ink/60">
              <Check size={11} /> saved <span className="font-mono">{savedKey}</span>
            </span>
          )}
        </div>
        <ConfigTabs
          tabs={OMP_SCHEMA.tabs}
          entries={writes.entries}
          activeTabId={activeTabId}
          onSelectTab={setActiveTabId}
          searchQuery={searchQuery}
          dirtyKeys={writes.dirtyKeys}
          savingKeys={writes.savingKeys}
          saveErrors={writes.saveErrors}
          onCommit={writes.commitValue}
          onReset={writes.resetKey}
          onDirty={writes.setDirty}
        />
      </div>

      <RoleEditor
        roles={modelRoles.roles}
        presets={modelRoles.presets}
        candidates={modelRoles.candidates}
        candidatesError={modelRoles.candidatesError}
        onSaveRoles={modelRoles.writeRoles}
        onSavePreset={modelRoles.savePreset}
        onUpdatePreset={modelRoles.updatePreset}
        onDeletePreset={modelRoles.deletePreset}
        savedRole={savedKey === 'role-map' ? 'roles' : null}
        writeError={modelRoles.writeError}
        onDismissWriteError={modelRoles.clearWriteError}
      />

      <ExtensionsPanel
        extensions={extensions}
        savedExtension={savedKey?.startsWith('ext-') ? savedKey.slice(4) : null}
        pendingIds={pendingExtensions}
        onToggle={handleToggleExtension}
      />
    </div>
  );
}
