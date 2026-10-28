/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Usage panel, the model picker, and the composer's thinking-level rule.
 *
 * - `format.ts` renders every number the panel shows. The boundaries are the
 *   point: the compact-token thresholds sit exactly at 1_000/1_000_000/1_000_000_000,
 *   a non-finite value must not leak "NaN" into the UI, and `usedPercent` clamps
 *   so an overage cannot paint a progress bar past 100%.
 * - `buildProviders` derives each row's one-line `hint` from three sources in a
 *   fixed precedence (kenari plan → DeepSeek balance → quota window), and picks
 *   the WORST used fraction — picking the first window instead shows a provider
 *   at 3% while it is actually at 98%.
 * - `buildPickerGroups` keys its hover index on the composite `provider:id`, not
 *   the bare id: the same model id is served by several providers, and an
 *   id-only key highlighted every provider's row at once.
 * - `resolveThinkingLevel` must keep a session's level when the ladder is
 *   unknown/empty, because an async catalog fetch resolving later used to reset
 *   the user's chosen effort to a ladder default.
 */

import { describe, expect, test } from 'bun:test';
import {
  formatAmount,
  formatCompactTokens,
  formatDateTime,
  formatFractionPercent,
  formatNumber,
  formatPercent,
  formatRp,
  formatUsageAmount,
  formatUsd,
  usedPercent,
} from '@/client/components/settings/categories/usage-settings/format';
import {
  buildProviders,
  statusLabel,
  type ProviderEntry,
} from '@/client/components/settings/categories/usage-settings/providers';
import { buildPickerGroups } from '@/client/components/workspace/model-dropdown/groups';
import {
  resolveThinkingLevel,
  selectionFor,
  UNKNOWN_THINKING_LEVEL,
} from '@/client/components/workspace/chat-timeline/chat-input/selection';
import type { AIModelOption, ModelEntry } from '@/shared/types';
import type { UsageLimitWindow, UsageProviderSummary, UsageReport } from '@/shared/types';

const window = (overrides: Partial<UsageLimitWindow> = {}): UsageLimitWindow =>
  ({ id: 'w', label: 'Window', unit: 'percent', status: 'ok', ...overrides }) as UsageLimitWindow;

const summary = (overrides: Partial<UsageProviderSummary> = {}): UsageProviderSummary =>
  ({ id: 'p', name: 'P', credentialSources: [], tracked: true, limits: [], ...overrides }) as UsageProviderSummary;

describe('usage number formatting', () => {
  test('formatRp groups Rupiah with no decimals', () => {
    // The space ICU puts between the symbol and the amount is locale DATA, not
    // our rule: newer CLDR emits `Rp\u00a01.234.567`, the older one shipped on
    // macOS emits `Rp1.234.567`. Grouping and the absent decimals are ours.
    const compact = (value: number): string => formatRp(value).replace(/\s/g, '');
    expect(compact(1234567)).toBe('Rp1.234.567');
    expect(compact(0)).toBe('Rp0');
  });

  test('formatNumber groups with the id-ID separator', () => {
    expect(formatNumber(1234.5)).toBe('1.234,5');
  });

  test('formatDateTime formats a real timestamp and echoes an unparseable one', () => {
    expect(formatDateTime('2024-03-05T10:30:00Z')).toContain('2024');
    expect(formatDateTime('not-a-date')).toBe('not-a-date');
  });

  test('usedPercent clamps to 0..100 and divides by zero safely', () => {
    expect(usedPercent(50, 100)).toBe(50);
    expect(usedPercent(150, 100)).toBe(100);
    expect(usedPercent(-10, 100)).toBe(0);
    expect(usedPercent(10, 0)).toBe(0);
  });

  test('formatPercent reports 0% for a zero total', () => {
    expect(formatPercent(10, 0)).toBe('0%');
    expect(formatPercent(1, 3)).toBe('33,3%');
    expect(formatPercent(1, 2)).toBe('50%');
  });

  test('formatCompactTokens switches unit exactly at each threshold', () => {
    expect(formatCompactTokens(999)).toBe('999');
    expect(formatCompactTokens(1000)).toBe('1,00K');
    expect(formatCompactTokens(61950)).toBe('61,95K');
    expect(formatCompactTokens(747642928)).toBe('747,64M');
    expect(formatCompactTokens(1124214260)).toBe('1,12B');
  });

  test('formatCompactTokens handles negatives and non-finite input', () => {
    expect(formatCompactTokens(-1500)).toBe('-1,50K');
    expect(formatCompactTokens(Number.NaN)).toBe('0');
    expect(formatCompactTokens(Number.POSITIVE_INFINITY)).toBe('0');
  });

  test('formatAmount parses a numeric string and echoes what it cannot parse', () => {
    expect(formatAmount('1234.5')).toBe('1.234,5');
    expect(formatAmount('')).toBe('');
    expect(formatAmount('n/a')).toBe('n/a');
  });

  test('formatUsd always shows two decimals, and never "$NaN"', () => {
    expect(formatUsd(12.5)).toBe('$12,50');
    expect(formatUsd(0)).toBe('$0,00');
    expect(formatUsd(Number.NaN)).toBe('$0,00');
  });

  test('formatUsageAmount dispatches on the unit and guards non-finite values', () => {
    expect(formatUsageAmount(50, 'percent')).toBe('50%');
    expect(formatUsageAmount(12.5, 'usd')).toBe('$12,50');
    expect(formatUsageAmount(61950, 'tokens')).toBe('61,95K');
    expect(formatUsageAmount(61950, 'bytes')).toBe('61,95K');
    expect(formatUsageAmount(61950, 'requests')).toBe('61.950');
    expect(formatUsageAmount(Number.NaN, 'tokens')).toBe('—');
  });

  test('formatFractionPercent renders a 0..1 fraction as a whole percent', () => {
    expect(formatFractionPercent(0.5)).toBe('50%');
    expect(formatFractionPercent(1 / 3)).toBe('33,3%');
    expect(formatFractionPercent(Number.NaN)).toBe('0%');
  });
});

describe('buildProviders', () => {
  test('maps each summary to a row in report order, carrying its own fields', () => {
    const report: UsageReport = {
      isMock: false,
      generatedAt: '2026-01-01T00:00:00Z',
      providers: [summary({ id: 'a', name: 'Alpha', tracked: true }), summary({ id: 'b', name: 'Beta', tracked: false })],
    };
    const entries = buildProviders(report);
    expect(entries.map((entry) => entry.id)).toEqual(['a', 'b']);
    expect(entries[0]?.name).toBe('Alpha');
    expect(entries[1]?.tracked).toBe(false);
    expect(entries[0]?.summary.id).toBe('a');
  });

  test('the provider\'s fetched web icon rides on the row', () => {
    // Both usage surfaces draw a mark, and the built-in glyph table cannot know
    // a models.yml gateway — so the icon the provider list fetched has to travel
    // with the summary or those rows show initials for a provider whose logo is
    // already stored.
    const entries = buildProviders({
      isMock: false,
      generatedAt: '',
      providers: [
        summary({ id: 'localtest', name: 'Local Test', iconUrl: '/api/provider-icon?slug=localtest&v=7' }),
        summary({ id: 'plain', name: 'Plain' }),
      ],
    });
    expect(entries[0]?.iconUrl).toBe('/api/provider-icon?slug=localtest&v=7');
    // Absent stays absent: an empty string would make the plate paint a broken
    // image and then fall back, which is a flash for no reason.
    expect('iconUrl' in (entries[1] ?? {})).toBe(false);
  });

  test('a kenari plan name is the hint', () => {
    const entry = buildProviders({
      isMock: false,
      generatedAt: '',
      providers: [summary({ kenari: { quota: { planName: 'Pro 30d', windows: [], coupon: null } } })],
    })[0];
    expect(entry?.hint).toBe('Pro 30d');
  });

  test('a DeepSeek balance is the hint when there is no plan', () => {
    const entry = buildProviders({
      isMock: false,
      generatedAt: '',
      providers: [
        summary({
          deepseek: { balance: { isAvailable: true, entries: [{ currency: 'USD', totalBalance: '12.34', grantedBalance: '0', toppedUpBalance: '12.34' }] } },
        }),
      ],
    })[0];
    expect(entry?.hint).toBe('USD 12,34');
  });

  test('the hint reports the WORST used fraction, not the first window', () => {
    const entry = buildProviders({
      isMock: false,
      generatedAt: '',
      providers: [
        summary({
          limits: [
            window({ usedFraction: 0.03, windowLabel: '5h' }),
            window({ usedFraction: 0.98, windowLabel: '7d' }),
          ],
        }),
      ],
    })[0];
    expect(entry?.hint).toBe('98% · 7d');
  });

  test('a used fraction with no window label reads "used"', () => {
    const entry = buildProviders({
      isMock: false,
      generatedAt: '',
      providers: [summary({ limits: [window({ usedFraction: 0.5 })] })],
    })[0];
    expect(entry?.hint).toBe('50% used');
  });

  test('a credit balance with no fraction reports what is left', () => {
    const entry = buildProviders({
      isMock: false,
      generatedAt: '',
      providers: [summary({ limits: [window({ unit: 'usd', remaining: 7.5, label: 'Credit' })] })],
    })[0];
    expect(entry?.hint).toBe('$7,50 left');
  });

  test('a label-only window falls back to the first label, then to a fixed phrase', () => {
    const labelled = buildProviders({
      isMock: false,
      generatedAt: '',
      providers: [summary({ limits: [window({ label: 'Daily', unit: 'requests' })] })],
    })[0];
    expect(labelled?.hint).toBe('Daily');

    const bare = buildProviders({ isMock: false, generatedAt: '', providers: [summary()] })[0];
    expect(bare?.hint).toBe('No quota reported');
  });

  test('statusLabel reports a provider failure as Error', () => {
    const failed = buildProviders({
      isMock: false,
      generatedAt: '',
      providers: [summary({ error: 'token expired' })],
    })[0] as ProviderEntry;
    expect(statusLabel(failed)).toBe('Error');
    expect(statusLabel({ ...failed, error: undefined })).toBe('Connected');
  });
});

describe('buildPickerGroups', () => {
  const model = (provider: string, id: string, name: string, extra: Partial<AIModelOption> = {}): AIModelOption =>
    ({ id, name, provider, ...extra }) as AIModelOption;

  const catalog: AIModelOption[] = [
    model('deepseek', 'v4-flash', 'Flash', { contextWindow: 128000, capabilities: ['tools'] }),
    model('kenari', 'v4-flash', 'Flash (Kenari)', { contextWindow: 64000 }),
    model('openai', 'gpt-5', 'GPT-5'),
  ];

  test('a search filters on name, provider, context window and capability', () => {
    expect(buildPickerGroups(catalog, 'flash', {}, [], []).filtered).toHaveLength(2);
    expect(buildPickerGroups(catalog, 'OPENAI', {}, [], []).filtered.map((m) => m.id)).toEqual(['gpt-5']);
    expect(buildPickerGroups(catalog, '64000', {}, [], []).filtered.map((m) => m.provider)).toEqual(['kenari']);
    expect(buildPickerGroups(catalog, 'tools', {}, [], []).filtered.map((m) => m.provider)).toEqual(['deepseek']);
    expect(buildPickerGroups(catalog, '   ', {}, [], []).filtered).toHaveLength(3);
  });

  test('the rails follow the stored key order, not the catalog order', () => {
    const groups = buildPickerGroups(catalog, '', {}, ['openai:gpt-5', 'deepseek:v4-flash'], ['kenari:v4-flash', 'openai:gpt-5']);
    expect(groups.favorites.map((m) => m.id)).toEqual(['gpt-5', 'v4-flash']);
    expect(groups.recent.map((m) => m.provider)).toEqual(['kenari']);
  });

  test('the rails are narrowed by the search like every other section', () => {
    const groups = buildPickerGroups(catalog, 'flash', {}, ['openai:gpt-5', 'deepseek:v4-flash'], []);
    expect(groups.favorites.map((m) => m.provider)).toEqual(['deepseek']);
  });

  test('providers are grouped under upper-cased names in catalog order', () => {
    const groups = buildPickerGroups(catalog, '', {}, [], []);
    expect(Object.keys(groups.byProvider)).toEqual(['DEEPSEEK', 'KENARI', 'OPENAI']);
    expect(groups.byProvider.DEEPSEEK).toHaveLength(1);
  });

  test('the flat list renders rails first, then provider sections', () => {
    const groups = buildPickerGroups(catalog, '', {}, ['openai:gpt-5'], ['deepseek:v4-flash']);
    // A rail model is NOT removed from its provider section: the flat list is the
    // order the panel walks for hover/keyboard focus, and a model appearing once
    // under a rail and again under its provider is the shipped behavior.
    expect(groups.visibleFlatList.map((m) => `${m.provider}:${m.id}`)).toEqual([
      'openai:gpt-5', // favorites rail
      'deepseek:v4-flash', // recent rail
      'deepseek:v4-flash', // DEEPSEEK section
      'kenari:v4-flash', // KENARI section
      'openai:gpt-5', // OPENAI section
    ]);
  });

  test('a collapsed section is dropped from the flat list but keeps its group', () => {
    const groups = buildPickerGroups(catalog, '', { favorites: true, KENARI: true }, ['openai:gpt-5'], []);
    expect(groups.visibleFlatList.map((m) => m.provider)).toEqual(['deepseek', 'openai']);
    expect(groups.byProvider.KENARI).toHaveLength(1);
  });

  test('the hover index is keyed by provider+id, so shared ids stay distinct', () => {
    const groups = buildPickerGroups(catalog, '', {}, [], []);
    expect(groups.index['deepseek:v4-flash']).toBe(0);
    expect(groups.index['kenari:v4-flash']).toBe(1);
    expect(groups.index['deepseek:v4-flash']).not.toBe(groups.index['kenari:v4-flash']);
  });
});

describe('resolveThinkingLevel', () => {
  test('a session level the model offers is authoritative', () => {
    expect(resolveThinkingLevel(['off', 'low', 'high'], 'high', 'low')).toBe('high');
  });

  test('an unknown or empty ladder keeps the session level', () => {
    expect(resolveThinkingLevel(undefined, 'high', 'low')).toBe('high');
    expect(resolveThinkingLevel([], 'high', 'low')).toBe('high');
  });

  test('a known ladder that excludes the session level falls back to the current one', () => {
    expect(resolveThinkingLevel(['off', 'low'], 'max', 'low')).toBe('low');
  });

  test('with nothing to go on the level stays "auto"', () => {
    expect(resolveThinkingLevel(['off'], null, null)).toBe(UNKNOWN_THINKING_LEVEL);
    expect(UNKNOWN_THINKING_LEVEL).toBe('auto');
  });

  test('selectionFor carries the catalog entry and resolves its level', () => {
    const match: ModelEntry = {
      id: 'v4-flash',
      name: 'Flash',
      provider: 'deepseek',
      contextWindow: 128000,
      thinkingLevels: ['off', 'low', 'high'],
    };
    expect(selectionFor(match, 'high', null)).toEqual({
      id: 'v4-flash',
      name: 'Flash',
      provider: 'deepseek',
      contextWindow: 128000,
      thinkingLevels: ['off', 'low', 'high'],
      thinkingLevel: 'high',
    });
  });

  test('selectionFor prefers the session level over the composer current one', () => {
    const match: ModelEntry = { id: 'm', name: 'M', provider: 'p', thinkingLevels: ['off', 'low', 'high'] };
    const current = { id: 'other', name: 'Other', provider: 'p', thinkingLevel: 'low' } as AIModelOption;
    expect(selectionFor(match, 'high', current).thinkingLevel).toBe('high');
  });
});
