/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Runtime schema access for the OMP Engine settings panel. The static
 * schema JSON (extracted from oh-my-pi's settings-schema.ts) drives tab,
 * group, label, and editor shape; live values come from the omp config CLI
 * bridge. Condition names mirror upstream's `CONDITIONS` map in
 * packages/coding-agent/src/modes/components/settings-defs.ts — entries with
 * a `ui.condition` render only when the condition holds.
 */

import schemaJson from '@/client/data/settings/omp-schema.json';
import type { OmpSchema, SchemaEntry } from '@/shared/lib/omp/config/schema-types';
import type { ConfigEntry } from '@/server/lib/omp/config/config-cli';
import { SCHEMA_EXTRAS } from '@/shared/lib/omp/config/schema-extras';

export const OMP_SCHEMA = schemaJson as unknown as OmpSchema;

/** All UI entries: upstream schema plus Kabmo-documented extras. */
export const ALL_SCHEMA_ENTRIES: Record<string, SchemaEntry> = {
  ...OMP_SCHEMA.entries,
  ...SCHEMA_EXTRAS,
};

/** Live value for a key from the config snapshot; undefined when unset. */
export function configValue(entries: Record<string, ConfigEntry>, key: string): unknown {
  return entries[key]?.value;
}

/**
 * Evaluate a `ui.condition` against the live config snapshot. Conditions
 * that describe the host terminal (macOS, image protocol) always hold in
 * Kabmo web view, which has neither platform limitation.
 */
export function isConditionMet(condition: string | undefined, entries: Record<string, ConfigEntry>): boolean {
  switch (condition) {
    case undefined:
      return true;
    case 'advisorEnabled':
      return configValue(entries, 'advisor.enabled') === true;
    case 'vimModeEnabled':
      return configValue(entries, 'tui.vimMode') === true;
    case 'hindsightActive':
      return configValue(entries, 'memory.backend') === 'hindsight';
    case 'mnemopiActive':
      return configValue(entries, 'memory.backend') === 'mnemopi';
    case 'autolearnActive':
      return configValue(entries, 'autolearn.enabled') === true;
    case 'autoThinkingActive':
      return configValue(entries, 'defaultThinkingLevel') === 'auto';
    case 'usageAwareFallbackEnabled':
      return configValue(entries, 'retry.usageAwareFallback') === true;
    case 'planModeEnabled':
      return configValue(entries, 'plan.enabled') === true;
    case 'planAutosaveEnabled':
      return configValue(entries, 'plan.enabled') === true && configValue(entries, 'plan.autosave') === true;
    case 'unexpectedStopSmart':
      return configValue(entries, 'features.unexpectedStopDetection') === 'smart';
    case 'macOS':
    case 'hasImageProtocol':
      return true;
    default:
      return true;
  }
}

/** Entries for one tab, in schema declaration order (extras last). */
export function entriesForTab(tabId: string): Array<[string, SchemaEntry]> {
  return Object.entries(ALL_SCHEMA_ENTRIES).filter(([, entry]) => entry.ui.tab === tabId);
}

/** True when the row matches the search query (key, label, or description). */
export function matchesSearch(key: string, entry: SchemaEntry, query: string): boolean {
  if (!query) return true;
  return key.toLowerCase().includes(query)
    || entry.ui.label.toLowerCase().includes(query)
    || entry.ui.description.toLowerCase().includes(query);
}
