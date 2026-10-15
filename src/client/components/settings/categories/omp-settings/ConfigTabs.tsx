/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Schema-driven tab/group renderer for native omp settings. Each tab shows
 * its groups in TAB_GROUPS order; rows render only when their schema
 * condition holds against the live config snapshot and when the global
 * search matches. Entries without UI metadata (upstream or extras) never
 * render — matching upstream's own panel surface plus chamber extras.
 */

import { useMemo } from 'preact/hooks';
import { Check, RotateCcw } from 'lucide-preact';
import type { ConfigEntry } from '@/server/lib/omp/config/config-cli';
import type { SchemaTab } from '@/shared/lib/omp/config/schema-types';
import { ALL_SCHEMA_ENTRIES, entriesForTab, isConditionMet, matchesSearch } from '@/shared/lib/omp/config/schema';
import { RowEditor } from '@/client/components/settings/categories/omp-settings/RowEditor';

interface ConfigTabsProps {
  tabs: SchemaTab[];
  entries: Record<string, ConfigEntry>;
  activeTabId: string;
  onSelectTab: (tabId: string) => void;
  searchQuery: string;
  dirtyKeys: Set<string>;
  savingKeys: Set<string>;
  saveErrors: Map<string, string>;
  onCommit: (key: string, value: unknown) => Promise<boolean>;
  onReset: (key: string) => Promise<boolean>;
  onDirty: (key: string, dirty: boolean, revert: () => void) => void;
}

export function ConfigTabs({
  tabs,
  entries,
  activeTabId,
  onSelectTab,
  searchQuery,
  dirtyKeys,
  savingKeys,
  saveErrors,
  onCommit,
  onReset,
  onDirty,
}: ConfigTabsProps) {
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];

  const visibleEntries = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (query) {
      return Object.entries(ALL_SCHEMA_ENTRIES)
        .filter(([key, entry]) => matchesSearch(key, entry, query))
        .map(([key]) => key)
        .slice(0, 80);
    }
    return entriesForTab(activeTab.id)
      .filter(([, entry]) => isConditionMet(entry.ui.condition, entries))
      .map(([key]) => key);
  }, [entries, activeTab.id, searchQuery]);

  /** Search results grouped by "Tab · Group", mirroring the tab/group layout. */
  const searchGroups = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const order: Array<{ id: string; label: string; keys: string[] }> = [];
    const byId = new Map<string, { label: string; keys: string[] }>();
    for (const key of visibleEntries) {
      const entry = ALL_SCHEMA_ENTRIES[key];
      const tab = tabs.find((t) => t.id === entry?.ui.tab);
      const id = `${entry?.ui.tab ?? '?'}\u0000${entry?.ui.group ?? ''}`;
      let bucket = byId.get(id);
      if (!bucket) {
        bucket = {
          label: entry?.ui.group
            ? `${tab?.label ?? entry?.ui.tab} · ${entry.ui.group}`
            : (tab?.label ?? entry?.ui.tab ?? 'Other'),
          keys: [],
        };
        byId.set(id, bucket);
        order.push({ id, ...bucket });
      }
      bucket.keys.push(key);
    }
    return order;
  }, [visibleEntries, searchQuery, tabs]);

  return (
    <div className="w-full flex flex-col gap-3 text-xs">
      {/* Horizontal tab pills — mirror omp's own setting tabs */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-overlay-container">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onSelectTab(tab.id)}
            className={`shrink-0 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer ${
              tab.id === activeTab.id
                ? 'bg-ink/10 text-ink'
                : 'text-ink/55 hover:bg-ink/5 hover:text-ink'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab body: groups with heading rows */}
      <div className="w-full rounded-lg border border-ink/10 divide-y divide-ink/5">
        {searchQuery.trim() ? (
          searchGroups.map((group) => (
            <GroupedRows
              key={group.id}
              keys={group.keys}
              entries={entries}
              groupLabel={group.label}
              dirtyKeys={dirtyKeys}
              savingKeys={savingKeys}
              saveErrors={saveErrors}
              onCommit={onCommit}
              onReset={onReset}
              onDirty={onDirty}
            />
          ))
        ) : (
          activeTab.groups.map((groupName) => {
            const keys = visibleEntries.filter((key) => ALL_SCHEMA_ENTRIES[key]?.ui.group === groupName);
            if (keys.length === 0) return null;
            return (
              <GroupedRows
                key={groupName}
                keys={keys}
                entries={entries}
                groupLabel={groupName}
                dirtyKeys={dirtyKeys}
                savingKeys={savingKeys}
                saveErrors={saveErrors}
                onCommit={onCommit}
                onReset={onReset}
                onDirty={onDirty}
              />
            );
          })
        )}
        {visibleEntries.length === 0 && (
          <div className="px-3 py-6 text-center text-ink/40">
            {searchQuery.trim() ? 'No settings match your search.' : 'No settings in this tab.'}
          </div>
        )}
      </div>
    </div>
  );
}

interface GroupedRowsProps {
  keys: string[];
  entries: Record<string, ConfigEntry>;
  groupLabel: string;
  dirtyKeys: Set<string>;
  savingKeys: Set<string>;
  saveErrors: Map<string, string>;
  onCommit: (key: string, value: unknown) => Promise<boolean>;
  onReset: (key: string) => Promise<boolean>;
  onDirty: (key: string, dirty: boolean, revert: () => void) => void;
}

function GroupedRows({
  keys,
  entries,
  groupLabel,
  dirtyKeys,
  savingKeys,
  saveErrors,
  onCommit,
  onReset,
  onDirty,
}: GroupedRowsProps) {
  return (
    <div>
      <div className="px-3 py-1.5 bg-ink/[0.02] text-[10px] uppercase tracking-wide text-ink/40 font-medium">
        {groupLabel}
      </div>
      {keys.map((key) => {
        const schemaEntry = ALL_SCHEMA_ENTRIES[key];
        if (!schemaEntry?.ui) return null;
        const liveValue = entries[key]?.value;
        const isDirty = dirtyKeys.has(key);
        const saving = savingKeys.has(key);
        const errorMessage = saveErrors.get(key);
        return (
          <div key={key} className="flex items-center justify-between gap-3 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="font-medium text-ink">{schemaEntry.ui.label}</span>
                <span className="font-mono text-[9px] text-ink/30" title="config key">{key}</span>
                {isDirty && !saving && (
                  <span className="shrink-0 rounded bg-warning/15 px-1 py-px text-[9px] font-semibold text-warning">unsaved</span>
                )}
                {saving && (
                  <span className="shrink-0 text-[9px] text-ink/40">saving…</span>
                )}
                {errorMessage && !saving && (
                  <span
                    className="shrink-0 rounded bg-error/10 px-1 py-px text-[9px] font-semibold text-error"
                    title={errorMessage}
                  >
                    save failed
                  </span>
                )}
              </div>
              {schemaEntry.ui.description && (
                <div className="text-[10px] text-ink/40 leading-snug">{schemaEntry.ui.description}</div>
              )}
              {/* omp's own refusal, in full: a stale key ("Unknown setting: …"),
                  a bad value ("Invalid value: …"), or the server's message. The
                  badge above only says a failure happened. */}
              {errorMessage && !saving && (
                <div className="text-[10px] text-error leading-snug">{errorMessage}</div>
              )}
              {schemaEntry.ui.warning && (
                <div className="text-[10px] text-error/80 leading-snug">{schemaEntry.ui.warning}</div>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <RowEditor
                entryKey={key}
                entry={schemaEntry}
                value={liveValue}
                initialValue={liveValue}
                onChangeDirty={onDirty}
                onCommit={onCommit}
                saving={saving}
                saveError={Boolean(errorMessage)}
              />
              <button
                type="button"
                aria-label={`Reset ${schemaEntry.ui.label}`}
                title="Reset to schema default"
                onClick={() => onReset(key)}
                disabled={saving}
                className={`rounded p-1 text-ink/30 hover:text-ink transition-colors cursor-pointer disabled:opacity-40 ${saving ? '' : 'hover:bg-ink/5'}`}
              >
                <RotateCcw size={11} />
              </button>
              {isDirty && (
                <Check size={11} className="text-ink/30" />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
