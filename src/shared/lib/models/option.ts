/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One registry entry as a picker row.
 *
 * `/api/models` answers `ModelEntry` (omp's registry, numbers for cost) while
 * every picker surface renders `AIModelOption` (display strings). One mapper
 * keeps the two from drifting: the model dropdown, the composer's
 * `@harness:<id>:` completion and any future reader describe the same row the
 * same way.
 */

import type { AIModelOption, ModelEntry } from '@/shared/types';

export function modelEntryOption(entry: ModelEntry): AIModelOption {
  const ladder = Array.isArray(entry.thinkingLevels) ? entry.thinkingLevels : [];
  const cost = entry.cost;
  return {
    id: entry.id,
    name: entry.name || entry.id,
    // A row without a provider still has to render. `/api/models` is read from
    // omp's registry, and a partial entry (a custom provider whose `provider`
    // field never landed) used to crash the whole picker — `buildPickerGroups`
    // upper-cased `undefined` and the composer's model pill took the chat input
    // down with it. `unknown` keeps the row visible and gives it a stable
    // section instead of dropping a model the user may have selected.
    provider: entry.provider || 'unknown',
    // The provider's fetched web icon, when the server has one. Carried through
    // so the picker's section header and the selected model's mark can draw the
    // site's own logo instead of the initials of a provider nobody has drawn.
    ...(entry.providerIconUrl ? { providerIconUrl: entry.providerIconUrl } : {}),
    contextWindow: entry.contextWindow,
    thinkingLevel: ladder[0] ?? 'off',
    thinkingLevels: ladder,
    capabilities: ladder.length > 1 ? ['Tool calling', 'Reasoning'] : ['Tool calling'],
    cost: cost ? {
      input: cost.input !== undefined ? `$${cost.input}` : '—',
      output: cost.output !== undefined ? `$${cost.output}` : '—',
      cacheRead: cost.cacheRead !== undefined ? `$${cost.cacheRead}` : undefined,
      cacheWrite: cost.cacheWrite !== undefined ? `$${cost.cacheWrite}` : undefined,
    } : undefined,
  };
}
