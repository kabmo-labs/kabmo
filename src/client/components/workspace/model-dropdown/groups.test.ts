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
    expect(groups.visibleFlatList.map((m) => m.id).sort()).toEqual(['a', 'b']);
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
