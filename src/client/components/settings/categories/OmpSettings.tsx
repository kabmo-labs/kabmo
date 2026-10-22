/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * OMP Engine settings panel — the complete native omp settings schema in
 * Kabmo modal.
 *
 * - Header: live engine state (running, model, thinking, context) + refresh.
 * - Config: every schema entry with UI metadata, rendered in omp's own
 *   tab/group layout (Appearance → Providers), with search across all keys,
 *   condition gating (e.g. mnemopi.* only when memory.backend === mnemopi),
 *   per-row reset-to-default, and debounced persistence through
 *   /api/settings/omp-config (omp config set under the hood).
 * - Model Roles: role → model selector overrides (config.yml modelRoles).
 * - Extensions: .omp/extensions toggles.
 */

import { useCallback, useEffect, useState } from 'preact/hooks';
import { RefreshCw, Search, X } from 'lucide-preact';
import type { SettingsState } from '@/shared/types';
import type { ConfigEntry } from '@/server/lib/omp/config/config-cli';
import { OMP_SCHEMA } from '@/shared/lib/omp/config/schema';
import { ConfigTabs } from '@/client/components/settings/categories/omp-settings/ConfigTabs';
import { RoleEditor } from '@/client/components/settings/categories/omp-settings/RoleEditor';
import { useModelRoles } from '@/client/hooks/settings/model-roles';
import { ExtensionsPanel } from '@/client/components/settings/categories/omp-settings/ExtensionsPanel';

interface OmpSettingsProps {
  settings: SettingsState;
  onUpdate: (updater: Partial<SettingsState> | ((prev: SettingsState) => SettingsState)) => void;
}

interface AgentState {
  model?: { provider?: string; id?: string };
  contextUsage?: { percent?: number } | null;
  fastModeEnabled?: boolean;
  thinkingLevel?: string;
}

interface ExtensionItem {
  id: string;
  name: string;
  sourceRoot: string;
  filePath: string;
  disabled: boolean;
}

export function OmpSettings(_props: OmpSettingsProps) {
  const [state, setState] = useState<AgentState | null>(null);
  const [stateRunning, setStateRunning] = useState(false);
  const [entries, setEntries] = useState<Record<string, ConfigEntry>>({});
  const [extensions, setExtensions] = useState<ExtensionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTabId, setActiveTabId] = useState(OMP_SCHEMA.tabs[0]?.id ?? 'model');
  const [searchQuery, setSearchQuery] = useState('');
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(new Set());
  const [savingKeys, setSavingKeys] = useState<Set<string>>(new Set());
  const [saveErrors, setSaveErrors] = useState<Map<string, string>>(new Map());

  /** Flash a saved badge for one key, then clear it. */
  const flashSaved = useCallback((key: string) => {
    setSavedKey(key);
    setTimeout(() => setSavedKey((current) => (current === key ? null : current)), 2000);
  }, []);

  // The role map, its presets and the role dropdowns' catalog. Its writes answer
  // with the server's whole map/list, so the panel never renders a guess.
  const modelRoles = useModelRoles(flashSaved);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch('/api/omp/state').then((res) => res.json()),
      fetch('/api/settings/omp-config').then((res) => res.json()),
      fetch('/api/model-roles').then((res) => res.json()),
      fetch('/api/omp/extensions').then((res) => res.json()),
    ])
      .then(([stateData, configData, rolesData, extensionsData]) => {
        if (stateData.running && stateData.state) setState(stateData.state as AgentState);
        setStateRunning(Boolean(stateData.running));
        if (configData.entries) setEntries(configData.entries as Record<string, ConfigEntry>);
        modelRoles.applyPayload(rolesData);
        if (Array.isArray(extensionsData.extensions)) setExtensions(extensionsData.extensions as ExtensionItem[]);
      })
      .catch((err) => console.error('Failed to load omp settings:', err))
      .finally(() => setLoading(false));
  }, [modelRoles.applyPayload]);

  useEffect(() => { load(); }, [load]);

  /**
   * Apply one write's outcome. A failure keeps omp's OWN sentence, not just a
   * flag: `omp config set` refuses a stale key with "Unknown setting: <key>",
   * a bad value with "Invalid value: …", and a timeout with nothing at all, and
   * a bare "save failed" badge made all three read the same. The server already
   * returns the sentence (`configFailureLine`); this is where it stops being
   * dropped.
   */
  const applyWriteResult = (key: string, ok: boolean, returned?: unknown, errorMessage?: string) => {
    setSavingKeys((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    setDirtyKeys((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    if (ok) {
      setSaveErrors((prev) => {
        if (!prev.has(key)) return prev;
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
      if (returned !== undefined) {
        setEntries((prev) => ({ ...prev, [key]: { ...prev[key], value: returned } }));
      }
      flashSaved(key);
    } else {
      setSaveErrors((prev) => new Map(prev).set(key, errorMessage ?? 'omp rejected the write'));
    }
  };

  /** Commit a value; all editors save on change/blur, never per keystroke. */
  const commitValue = useCallback(async (key: string, value: unknown): Promise<boolean> => {
    setSavingKeys((prev) => new Set(prev).add(key));
    setDirtyKeys((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    try {
      const res = await fetch('/api/settings/omp-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      });
      const data = await res.json();
      const ok = Boolean(data.success);
      applyWriteResult(key, ok, data.value, typeof data.error === 'string' ? data.error : undefined);
      return ok;
    } catch (err) {
      console.error('Failed to save omp config:', err);
      applyWriteResult(key, false, undefined, err instanceof Error ? err.message : undefined);
      return false;
    }
  }, []);

  const handleReset = useCallback(async (key: string): Promise<boolean> => {
    setSavingKeys((prev) => new Set(prev).add(key));
    try {
      const res = await fetch('/api/settings/omp-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, action: 'reset' }),
      });
      const data = await res.json();
      const ok = Boolean(data.success);
      applyWriteResult(key, ok, data.value, typeof data.error === 'string' ? data.error : undefined);
      return ok;
    } catch (err) {
      console.error('Failed to reset omp config:', err);
      applyWriteResult(key, false, undefined, err instanceof Error ? err.message : undefined);
      return false;
    }
  }, []);

  const handleDirty = useCallback((key: string, dirty: boolean) => {
    setDirtyKeys((prev) => {
      const next = new Set(prev);
      if (dirty) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  const handleToggleExtension = (extension: ExtensionItem) => {
    fetch('/api/omp/extensions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: extension.id, disabled: !extension.disabled }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setExtensions((prev) => prev.map((item) => (
            item.id === extension.id ? { ...item, disabled: !extension.disabled } : item
          )));
          flashSaved(`ext-${extension.id}`);
        }
      })
      .catch((err) => console.error('Failed to toggle extension:', err));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8 text-ink/40 text-xs">
        Loading OMP settings...
      </div>
    );
  }

  return (
    <div className="w-full space-y-4 text-ink pb-2 text-xs">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-ink/10">
        <div>
          <h2 className="text-sm font-semibold text-ink">OMP Engine</h2>
          <p className="text-ink/50 mt-0.5">Live agent state and the full native config schema from oh-my-pi.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink/40 pointer-events-none" />
            <input
              aria-label="Search settings"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.currentTarget.value)}
              placeholder="Search settings…"
              className="w-44 bg-paper border border-ink/15 rounded-md pl-6 pr-6 py-1 text-ink placeholder:text-ink/40"
            />
            {searchQuery && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setSearchQuery('')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-ink/40 hover:text-ink cursor-pointer"
              >
                <X size={11} />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={load}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-ink/15 text-ink/70 hover:text-ink hover:bg-ink/5 transition-all cursor-pointer"
          >
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="rounded-lg border border-ink/10 bg-ink/[0.03] px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-ink/40">Engine</div>
          <div className="font-semibold text-ink mt-0.5">{stateRunning ? 'Running' : 'Idle'}</div>
        </div>
        <div className="rounded-lg border border-ink/10 bg-ink/[0.03] px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-ink/40">Model</div>
          <div className="font-semibold text-ink mt-0.5 truncate">{state?.model?.id ?? '—'}</div>
        </div>
        <div className="rounded-lg border border-ink/10 bg-ink/[0.03] px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-ink/40">Thinking</div>
          <div className="font-semibold text-ink mt-0.5">{state?.thinkingLevel ?? '—'}</div>
        </div>
        <div className="rounded-lg border border-ink/10 bg-ink/[0.03] px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-ink/40">Context</div>
          <div className="font-semibold text-ink mt-0.5">
            {state?.contextUsage?.percent != null ? `${state.contextUsage.percent.toFixed(1)}%` : '—'}
          </div>
        </div>
      </div>

      <div className="pt-1">
        <div className="flex items-center justify-between pb-2">
          <div>
            <h3 className="text-sm font-semibold text-ink">Config</h3>
            <p className="text-ink/50 mt-0.5">
              Schema-driven settings backed by <span className="font-mono">omp config</span>.
              {searchQuery.trim() && ' — matching keys only'}
            </p>
          </div>
          {savedKey && savedKey !== 'role-map' && !savedKey.startsWith('ext-') && (
            <span className="inline-flex items-center gap-1 text-[10px] text-ink/60">saved {savedKey}</span>
          )}
        </div>
        <ConfigTabs
          tabs={OMP_SCHEMA.tabs}
          entries={entries}
          activeTabId={activeTabId}
          onSelectTab={setActiveTabId}
          searchQuery={searchQuery}
          dirtyKeys={dirtyKeys}
          savingKeys={savingKeys}
          saveErrors={saveErrors}
          onCommit={commitValue}
          onReset={handleReset}
          onDirty={handleDirty}
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
        onToggle={handleToggleExtension}
      />
    </div>
  );
}
