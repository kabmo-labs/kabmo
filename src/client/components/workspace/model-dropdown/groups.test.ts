/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The picker's derived grouping, with the row shapes that have actually arrived.
 *
 * The case that matters is a model entry with NO provider. `/api/models` is a
 * projection of omp's registry, and a partial entry (a custom provider whose
 * field never landed) reached `buildPickerGroups` as `undefined` and threw
 * `model.provider.toUpperCase` — which took the whole composer down, because
 * the model pill renders inside `ChatInput`. Measured: eight `compact composer`
 * cases failed with exactly that stack, in a suite that never mentions models.
 *
 * The guard is `String(… ?? 'unknown')`, so the row stays visible under a
 * stable section instead of vanishing from a list the user may have selected.
 *
 * The second rule pinned here is row identity: `section::provider:id`. A model
 * is drawn in a rail AND in its provider section, and a `modelKey`-keyed index
 * could describe only one of the two — so ArrowDown stepped over the rail rows
 * and the specs card anchored to the wrong one.
 *
 * The third is the rails' LABEL: FAVORITES and RECENT have no provider heading,
 * so `ambiguousNames` (the names more than one provider serves) is what decides
 * whether a rail row carries a provider tag. The catalog-wide cases at the
 * bottom moved here from `usage-and-picker.test.ts`, which had grown past the
 * 350-line ceiling — grouping is this module's subject, and the usage panel is
 * not.
 */

import { describe, expect, test } from 'bun:test';
import { buildPickerGroups } from '@/client/components/workspace/model-dropdown/groups';
import type { AIModelOption } from '@/shared/types';

function model(overrides: Partial<AIModelOption> & { id: string }): AIModelOption {
  return { name: overrides.id, provider: 'p', ...overrides } as AIModelOption;
}

describe('buildPickerGroups', () => {
  test('a row with no provider does not throw, and keeps its section', () => {
    const rows = [model({ id: 'a' }), { id: 'b', name: 'B' } as AIModelOption];
    const groups = buildPickerGroups(rows, '', {}, [], []);
    expect(Object.keys(groups.byProvider).sort()).toEqual(['P', 'UNKNOWN']);
    expect(groups.byProvider.UNKNOWN?.map((m) => m.id)).toEqual(['b']);
    // It is still a row the user can see and pick.
    expect(groups.visibleFlatList.map((row) => row.model.id).sort()).toEqual(['a', 'b']);
  });

  test('an empty provider string lands in the same section as a missing one', () => {
    const groups = buildPickerGroups([model({ id: 'a', provider: '' })], '', {}, [], []);
    expect(Object.keys(groups.byProvider)).toEqual(['UNKNOWN']);
  });

  test('a search still narrows a guarded row rather than crashing on it', () => {
    const rows = [model({ id: 'a', name: 'Alpha' }), { id: 'b', name: 'Beta' } as AIModelOption];
    const groups = buildPickerGroups(rows, 'beta', {}, [], []);
    expect(groups.filtered.map((m) => m.id)).toEqual(['b']);
  });

  test('the same model drawn in a rail and in its section makes two rows', () => {
    const rows = [
      model({ id: 'v4', provider: 'deepseek', name: 'DeepSeek V4' }),
      model({ id: 'v4', provider: 'kenari', name: 'DeepSeek V4' }),
    ];
    const groups = buildPickerGroups(rows, '', {}, ['deepseek:v4'], []);

    // A rail row and its provider-section copy are different rows: without this
    // the hover index held one of the two, ArrowDown skipped the rail, and both
    // rows highlighted together.
    expect(groups.visibleFlatList.map((row) => row.rowId)).toEqual([
      'favorites::deepseek:v4',
      'DEEPSEEK::deepseek:v4',
      'KENARI::kenari:v4',
    ]);
    expect(groups.index['favorites::deepseek:v4']).toBe(0);
    expect(groups.index['DEEPSEEK::deepseek:v4']).toBe(1);
  });

  test('only a name two providers serve is ambiguous, so one row per duplicate is tagged', () => {
    const groups = buildPickerGroups(
      [
        model({ id: 'v4', provider: 'deepseek', name: 'DeepSeek V4' }),
        model({ id: 'v4', provider: 'kenari', name: 'DeepSeek V4' }),
        model({ id: 'solo', provider: 'openai', name: 'GPT-5' }),
      ],
      'gpt',
      {},
      [],
      [],
    );

    // Computed over the whole catalog, not the filtered list: a tag that came and
    // went as the reader typed made the rows jump.
    expect([...groups.ambiguousNames]).toEqual(['deepseek v4']);
    expect(groups.filtered).toHaveLength(1);
  });

  test('a repeated stored key draws one row, not two', () => {
    const groups = buildPickerGroups(
      [model({ id: 'a', provider: 'p' })],
      '',
      {},
      [],
      ['p:a', 'p:a'],
    );

    // Two copies of a row id would share one index and one anchor.
    expect(groups.recent).toHaveLength(1);
    expect(groups.visibleFlatList.map((row) => row.rowId)).toEqual(['recent::p:a', 'P::p:a']);
  });

  test('one provider spelled two ways does not make its model name ambiguous', () => {
    const groups = buildPickerGroups(
      [model({ id: 'a', provider: 'deepseek', name: 'Flash' }), model({ id: 'b', provider: 'DeepSeek', name: 'Flash' })],
      '',
      {},
      [],
      [],
    );

    // Both rows land in the one DEEPSEEK section, so a tag would claim an
    // ambiguity the reader cannot see.
    expect(Object.keys(groups.byProvider)).toEqual(['DEEPSEEK']);
    expect([...groups.ambiguousNames]).toEqual([]);
  });

  test('rows group by upper-cased provider and keep catalog order', () => {
    const groups = buildPickerGroups(
      [model({ id: 'a', provider: 'anthropic' }), model({ id: 'b', provider: 'Anthropic' })],
      '',
      {},
      [],
      [],
    );
    expect(Object.keys(groups.byProvider)).toEqual(['ANTHROPIC']);
    expect(groups.byProvider.ANTHROPIC?.map((m) => m.id)).toEqual(['a', 'b']);
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
    expect(groups.visibleFlatList.map((row) => `${row.model.provider}:${row.model.id}`)).toEqual([
      'openai:gpt-5', // favorites rail
      'deepseek:v4-flash', // recent rail
      'deepseek:v4-flash', // DEEPSEEK section
      'kenari:v4-flash', // KENARI section
      'openai:gpt-5', // OPENAI section
    ]);
    // …and each of those five positions is its OWN row, even where two of them
    // carry the same model.
    expect(new Set(groups.visibleFlatList.map((row) => row.rowId)).size).toBe(5);
  });

  test('a collapsed section is dropped from the flat list but keeps its group', () => {
    const groups = buildPickerGroups(catalog, '', { favorites: true, KENARI: true }, ['openai:gpt-5'], []);
    expect(groups.visibleFlatList.map((row) => row.model.provider)).toEqual(['deepseek', 'openai']);
    expect(groups.byProvider.KENARI).toHaveLength(1);
  });

  test('the hover index is keyed by provider+id, so shared ids stay distinct', () => {
    const groups = buildPickerGroups(catalog, '', {}, [], []);
    expect(groups.index['DEEPSEEK::deepseek:v4-flash']).toBe(0);
    expect(groups.index['KENARI::kenari:v4-flash']).toBe(1);
    expect(groups.index['DEEPSEEK::deepseek:v4-flash'])
      .not.toBe(groups.index['KENARI::kenari:v4-flash']);
  });

  test('a row drawn twice gets two indexes and two anchors', () => {
    // The bug this pins: a favorite is drawn in the rail and again under its
    // provider. A `modelKey`-keyed index held only one of them, so the rails
    // were skipped by ArrowDown and both rows lit up together.
    const groups = buildPickerGroups(catalog, '', {}, ['openai:gpt-5'], []);
    const rail = groups.index['favorites::openai:gpt-5'];
    const provider = groups.index['OPENAI::openai:gpt-5'];
    expect(rail).toBe(0);
    expect(provider).toBeGreaterThan(rail ?? -1);
  });

  test('only a name served by two providers is marked ambiguous', () => {
    const ambiguousCatalog = [...catalog, model('kenari', 'v4-flash-2', 'Flash', {})];
    expect([...buildPickerGroups(ambiguousCatalog, '', {}, [], []).ambiguousNames].sort()).toEqual(['flash']);
    expect([...buildPickerGroups(catalog, '', {}, [], []).ambiguousNames]).toEqual([]);
  });
});
