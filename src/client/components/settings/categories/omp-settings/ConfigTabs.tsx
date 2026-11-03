/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Schema-driven tab/group renderer for native omp settings. Each tab shows
 * its groups in TAB_GROUPS order; rows render only when their schema
 * condition holds against the live config snapshot and when the global
 * search matches. Entries without UI metadata (upstream or extras) never
 * render — matching upstream's own panel surface plus Kabmo extras.
 *
 * Search is a WHOLE-SCHEMA view, so the tab strip is replaced by its own
 * summary line while a query is active: leaving the pills up made a tab click
 * look broken, because results stay global and the highlighted tab changed
 * nothing. Each tab carries its visible row count so an empty tab is
 * recognisable before it is opened, and `Reset` is offered only for a key that
 * config.yml actually holds — resetting an unset key wrote nothing and looked
 * like a failure.
 */

import { useMemo } from 'preact/hooks';
import { Check, RotateCcw, Search, X } from 'lucide-preact';
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
  onDirty: (key: string, dirty: boolean) => void;
}

const SEARCH_LIMIT = 80;

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
  const query = searchQuery.trim().toLowerCase();

  /** Keys per tab under the live snapshot, so the pills can state a count. */
  const countsByTab = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of Object.values(ALL_SCHEMA_ENTRIES)) {
      if (!entry.ui || !isConditionMet(entry.ui.condition, entries)) continue;
      counts.set(entry.ui.tab, (counts.get(entry.ui.tab) ?? 0) + 1);
    }
    return counts;
  }, [entries]);

  const visibleEntries = useMemo(() => {
    if (query) {
      return Object.entries(ALL_SCHEMA_ENTRIES)
        .filter(([key, entry]) => entry.ui && matchesSearch(key, entry, query))
        .map(([key]) => key)
        .slice(0, SEARCH_LIMIT);
    }
    return entriesForTab(activeTab.id)
      .filter(([, entry]) => entry.ui && isConditionMet(entry.ui.condition, entries))
      .map(([key]) => key);
  }, [entries, activeTab.id, query]);

  /** Search results grouped by "Tab · Group", mirroring the tab/group layout. */
  const searchGroups = useMemo(() => {
    if (!query) return [];
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
  }, [visibleEntries, query, tabs]);

  const totalMatches = useMemo(
    () => (query
      ? Object.entries(ALL_SCHEMA_ENTRIES).filter(([key, entry]) => entry.ui && matchesSearch(key, entry, query)).length
      : 0),
    [query],
  );

  return (
    <div className="w-full flex flex-col gap-3 text-xs">
      {query ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-ink/15 bg-ink/[0.03] px-2.5 py-1.5">
          <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-ink/60">
            <Search size={11} className="shrink-0 text-ink/40" />
            <span className="truncate">
              Searching every tab — <span className="font-medium text-ink">{totalMatches}</span>
              {totalMatches > SEARCH_LIMIT && <span> (showing the first {SEARCH_LIMIT})</span>}
              {' '}matching key{totalMatches === 1 ? '' : 's'}
            </span>
          </span>
          <span className="shrink-0 rounded bg-ink/10 px-1.5 py-px font-mono text-[10px] text-ink/60">{searchQuery.trim()}</span>
        </div>
      ) : (
        <div
          role="tablist"
          aria-label="OMP config tabs"
          className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-overlay-container"
        >
          {tabs.map((tab) => {
            const isActive = tab.id === activeTab.id;
            const count = countsByTab.get(tab.id) ?? 0;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => onSelectTab(tab.id)}
                title={count === 0 ? `${tab.label} — no setting is available in this tab right now` : `${count} setting${count === 1 ? '' : 's'}`}
                className={`shrink-0 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-ink/10 text-ink'
                    : 'text-ink/55 hover:bg-ink/5 hover:text-ink'
                }`}
              >
                {tab.label}
                <span className={`ml-1.5 font-mono text-[9px] ${isActive ? 'text-ink/50' : 'text-ink/30'}`}>{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {query && (
        <div className="flex items-center gap-2 text-[10px] text-ink/40">
          <X size={10} />
          Clear the search to browse by tab again.
        </div>
      )}

      <div className="w-full rounded-lg border border-ink/10 divide-y divide-ink/5">
        {query ? (
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
            {query ? 'No setting matches that search.' : 'No setting is available in this tab right now.'}
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
  onDirty: (key: string, dirty: boolean) => void;
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
        // `omp config list` carries every registered key; an unset one has no
        // `value`. Reset is only meaningful when config.yml holds a value.
        const isStored = entries[key]?.value !== undefined;
        const isDirty = dirtyKeys.has(key);
        const saving = savingKeys.has(key);
        const errorMessage = saveErrors.get(key);
        return (
          <div key={key} className="flex items-start justify-between gap-3 px-3 py-2 hover:bg-ink/[0.02]">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
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
            <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
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
                title={isStored ? 'Reset to the schema default' : 'This key is not set — omp already uses the schema default'}
                onClick={() => onReset(key)}
                disabled={saving || !isStored}
                className="rounded p-1 text-ink/30 hover:text-ink transition-colors cursor-pointer hover:bg-ink/5 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
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
