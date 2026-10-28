/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The settings panel is driven entirely by the static schema table plus the
 * Kabmo's extras, and the spawn path by the access-mode guard. A wrong
 * `ui.tab` or condition silently hides a row the docs promise; a lost extra
 * drops a documented setting from the panel; a permissive access-mode guard
 * spawns omp in a mode the user never picked. These tests pin the merge, the
 * condition table, and the approval-mode vocabulary.
 */

import { describe, expect, test } from 'bun:test';

import {
  APPROVAL_MODES,
  ACCESS_MODE_SETTING_KEY,
  DEFAULT_APPROVAL_MODE,
  isApprovalMode,
  normalizeApprovalMode,
} from '@/shared/lib/omp/config/access-mode';
import { SCHEMA_EXTRAS } from '@/shared/lib/omp/config/schema-extras';
import { ALL_SCHEMA_ENTRIES, OMP_SCHEMA, configValue, entriesForTab, isConditionMet, matchesSearch } from '@/shared/lib/omp/config/schema';
import type { ConfigEntry } from '@/server/lib/omp/config/config-cli';

/** Build a config snapshot from `{ key: value }` pairs. */
function snapshot(values: Record<string, unknown>): Record<string, ConfigEntry> {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value } as ConfigEntry]));
}

describe('OMP_SCHEMA', () => {
  test('carries the upstream source and all ten tabs in order', () => {
    // `source` names the generator's input, so a regenerated file says which
    // omp it came from; the tabs themselves are the pinned part.
    expect(OMP_SCHEMA.source).toContain('@oh-my-pi/pi-coding-agent');
    expect(OMP_SCHEMA.tabs.map((tab) => tab.id)).toEqual([
      'appearance', 'model', 'interaction', 'context', 'memory', 'files', 'shell', 'tools', 'tasks', 'providers',
    ]);
  });

  test('every entry declares a type and a ui block', () => {
    const malformed = Object.entries(OMP_SCHEMA.entries).filter(([, entry]) => !entry.type || !entry.ui?.tab);
    expect(malformed).toEqual([]);
  });

  test('every entry sits in a declared tab and group, and every tab has rows', () => {
    // The panel renders rows by looking a tab up in `tabs` and a group up in
    // that tab's `groups`; a key that names neither is a row no filter can
    // reach. This is what a bad regeneration looks like, and it is checkable
    // without an omp install — unlike the schema's freshness, which
    // `bun run omp:schema:check` owns.
    const tabIds = new Set(OMP_SCHEMA.tabs.map((tab) => tab.id));
    const groupsByTab = new Map(OMP_SCHEMA.tabs.map((tab) => [tab.id, new Set(tab.groups)]));
    const stray = Object.entries(OMP_SCHEMA.entries).filter(([, entry]) => {
      const { tab, group } = entry.ui;
      if (!tabIds.has(tab)) return true;
      if (!group) return false;
      return !groupsByTab.get(tab)?.has(group);
    });
    expect(stray).toEqual([]);
    const empty = OMP_SCHEMA.tabs.filter((tab) => !entriesForTab(tab.id).length).map((tab) => tab.id);
    expect(empty).toEqual([]);
  });

  test('the settings that upstream added after the panel was written are present', () => {
    // Pins the reason the schema is generated at all: these were unreachable
    // while the JSON sat frozen at the migration commit.
    for (const key of ['title.icons', 'title.generator', 'tui.renderSvg', 'tui.autoGraph', 'task.completionProbe', 'providers.cacheWarming']) {
      expect(OMP_SCHEMA.entries[key]).toBeDefined();
    }
    // Replaced by the on/off form in omp 18.5.0 — offering it writes a key the
    // binary rejects.
    expect(OMP_SCHEMA.entries['task.completionProbeMs']).toBeUndefined();
  });

  test('the folders that always ask are offered (omp 18.13.1)', () => {
    // `tools.restrictedFolders` is where every read, write, edit, search or
    // command asks in EVERY approval mode. The panel is the only place a user
    // can set it, so a schema regenerated without the row makes the feature
    // unreachable from the console.
    const entry = OMP_SCHEMA.entries['tools.restrictedFolders'];
    expect(entry).toBeDefined();
    expect(entry?.type).toBe('array');
    expect(entry?.ui.tab).toBe('interaction');
    expect(entry?.ui.group).toBe('Approvals');
  });
});

describe('ALL_SCHEMA_ENTRIES', () => {
  test('merges every Kabmo extra on top of the upstream entries', () => {
    for (const key of Object.keys(SCHEMA_EXTRAS)) {
      expect(ALL_SCHEMA_ENTRIES[key]).toBe(SCHEMA_EXTRAS[key]);
    }
  });

  test('the documented extras keep their defaults', () => {
    expect(SCHEMA_EXTRAS['retry.enabled'].default).toBe(true);
    expect(SCHEMA_EXTRAS['retry.baseDelayMs'].default).toBe(500);
    expect(SCHEMA_EXTRAS['thinkingBudgets.medium'].default).toBe(8192);
    expect(SCHEMA_EXTRAS['compaction.keepRecentTokens'].default).toBe(20000);
    expect(SCHEMA_EXTRAS.cycleOrder.default).toEqual(['smol', 'default', 'slow']);
    expect(SCHEMA_EXTRAS.modelTags.default).toEqual({});
    expect(SCHEMA_EXTRAS.modelProviderOrder.default).toEqual([]);
  });

  test('extras never override an upstream entry', () => {
    // The panel renders the upstream row where one exists; an extra that
    // shadowed it would change the editor shape behind the schema's back.
    const upstream = Object.keys(OMP_SCHEMA.entries);
    const shadowed = Object.keys(SCHEMA_EXTRAS).filter((key) => upstream.includes(key));
    expect(shadowed).toEqual([]);
  });
});

describe('configValue', () => {
  test('returns the live value, or undefined when unset', () => {
    const entries = snapshot({ 'advisor.enabled': true });
    expect(configValue(entries, 'advisor.enabled')).toBe(true);
    expect(configValue(entries, 'missing.key')).toBeUndefined();
  });
});

describe('isConditionMet', () => {
  test('an absent condition always renders', () => {
    expect(isConditionMet(undefined, {})).toBe(true);
  });

  test('each known condition reads exactly one key', () => {
    expect(isConditionMet('advisorEnabled', snapshot({ 'advisor.enabled': true }))).toBe(true);
    expect(isConditionMet('advisorEnabled', snapshot({ 'advisor.enabled': false }))).toBe(false);
    expect(isConditionMet('vimModeEnabled', snapshot({ 'tui.vimMode': true }))).toBe(true);
    expect(isConditionMet('hindsightActive', snapshot({ 'memory.backend': 'hindsight' }))).toBe(true);
    expect(isConditionMet('hindsightActive', snapshot({ 'memory.backend': 'mnemopi' }))).toBe(false);
    expect(isConditionMet('mnemopiActive', snapshot({ 'memory.backend': 'mnemopi' }))).toBe(true);
    expect(isConditionMet('autolearnActive', snapshot({ 'autolearn.enabled': true }))).toBe(true);
    expect(isConditionMet('autoThinkingActive', snapshot({ defaultThinkingLevel: 'auto' }))).toBe(true);
    expect(isConditionMet('autoThinkingActive', snapshot({ defaultThinkingLevel: 'high' }))).toBe(false);
    expect(isConditionMet('usageAwareFallbackEnabled', snapshot({ 'retry.usageAwareFallback': true }))).toBe(true);
    expect(isConditionMet('unexpectedStopSmart', snapshot({ 'features.unexpectedStopDetection': 'smart' }))).toBe(true);
    expect(isConditionMet('unexpectedStopSmart', snapshot({ 'features.unexpectedStopDetection': 'on' }))).toBe(false);
  });

  test('a missing snapshot value does not satisfy a condition', () => {
    expect(isConditionMet('advisorEnabled', {})).toBe(false);
    expect(isConditionMet('planModeEnabled', {})).toBe(false);
  });

  test('plan autosave requires BOTH plan.enabled and plan.autosave', () => {
    expect(isConditionMet('planAutosaveEnabled', snapshot({ 'plan.enabled': true, 'plan.autosave': true }))).toBe(true);
    expect(isConditionMet('planAutosaveEnabled', snapshot({ 'plan.enabled': true, 'plan.autosave': false }))).toBe(false);
    expect(isConditionMet('planAutosaveEnabled', snapshot({ 'plan.enabled': false, 'plan.autosave': true }))).toBe(false);
  });

  test('host-terminal conditions always hold in the web view', () => {
    // The Kabmo is neither macOS-limited nor image-protocol-limited, so these
    // rows must never disappear.
    expect(isConditionMet('macOS', {})).toBe(true);
    expect(isConditionMet('hasImageProtocol', {})).toBe(true);
  });

  test('an unknown condition degrades to visible', () => {
    expect(isConditionMet('someFutureCondition', {})).toBe(true);
  });
});

describe('entriesForTab', () => {
  test('returns only that tab, in schema order, extras last', () => {
    const rows = entriesForTab('shell');
    const keys = rows.map(([key]) => key);
    expect(rows.every(([, entry]) => entry.ui.tab === 'shell')).toBe(true);
    expect(keys).toContain('shellPath');
    expect(keys).toContain('bash.autoBackground.thresholdMs');
    // Extras are appended after the upstream entries.
    expect(keys.indexOf('shellPath')).toBeGreaterThan(-1);
    const upstreamKeys = keys.filter((key) => key in OMP_SCHEMA.entries);
    expect(keys.slice(0, upstreamKeys.length)).toEqual(upstreamKeys);
  });

  test('an unknown tab yields no rows', () => {
    expect(entriesForTab('nope')).toEqual([]);
  });
});

describe('matchesSearch', () => {
  const entry = ALL_SCHEMA_ENTRIES['retry.enabled'];

  test('an empty query matches everything', () => {
    expect(matchesSearch('retry.enabled', entry, '')).toBe(true);
  });

  test('matches the key, label, or description, case-insensitively', () => {
    expect(matchesSearch('retry.enabled', entry, 'retry.enab')).toBe(true);
    expect(matchesSearch('retry.enabled', entry, 'transient provider')).toBe(true);
    expect(matchesSearch('retry.enabled', entry, entry.ui.label.toLowerCase())).toBe(true);
    expect(matchesSearch('retry.enabled', entry, 'no-such-term')).toBe(false);
  });
});

describe('access mode', () => {
  test('the value list and default are the omp contract', () => {
    expect(APPROVAL_MODES).toEqual(['always-ask', 'write', 'yolo']);
    expect(DEFAULT_APPROVAL_MODE).toBe('always-ask');
    expect(ACCESS_MODE_SETTING_KEY).toBe('omp_access_mode');
  });

  test('isApprovalMode accepts exactly the three modes', () => {
    expect(isApprovalMode('always-ask')).toBe(true);
    expect(isApprovalMode('write')).toBe(true);
    expect(isApprovalMode('yolo')).toBe(true);
    expect(isApprovalMode('alwaysask')).toBe(false);
    expect(isApprovalMode('YOLO')).toBe(false);
    expect(isApprovalMode(undefined)).toBe(false);
    expect(isApprovalMode(3)).toBe(false);
  });

  test('normalizeApprovalMode keeps valid values and defaults the rest', () => {
    expect(normalizeApprovalMode('yolo')).toBe('yolo');
    expect(normalizeApprovalMode('write')).toBe('write');
    // A persisted row is a bare string; an unknown or empty one falls back.
    expect(normalizeApprovalMode('')).toBe(DEFAULT_APPROVAL_MODE);
    expect(normalizeApprovalMode('sudo')).toBe(DEFAULT_APPROVAL_MODE);
    expect(normalizeApprovalMode(null)).toBe(DEFAULT_APPROVAL_MODE);
  });
});
