/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import type { AIModelOption } from '@/shared/types';
import { modelKey } from '@/shared/lib/models/identity';

export interface ModelPickerGroups {
  filtered: AIModelOption[];
  favorites: AIModelOption[];
  recent: AIModelOption[];
  /** Provider display name (upper-cased) → its models, in catalog order. */
  byProvider: Record<string, AIModelOption[]>;
  /** Sections expanded, in the order the panel renders them. */
  visibleFlatList: AIModelOption[];
  /** Composite key → index in `visibleFlatList`, for hover/keyboard focus. */
  index: Record<string, number>;
}

/**
 * Models named by an ordered key list, in that order.
 *
 * The order is the point: RECENT means "most recently used first", and the
 * catalog's own order is alphabetical by name — so reading recents off a flag
 * (the previous `isRecent`) could not express the ranking at all, and a
 * re-picked model never moved back to the top.
 */
function modelsInKeyOrder(models: AIModelOption[], keys: readonly string[]): AIModelOption[] {
  if (keys.length === 0) return [];
  const byKey = new Map(models.map((model) => [modelKey(model), model]));
  const ordered: AIModelOption[] = [];
  for (const key of keys) {
    const match = byKey.get(key);
    if (match) ordered.push(match);
  }
  return ordered;
}

/**
 * All derived picker state in one place: search filtering, the favorites/recent
 * rails, the per-provider grouping, and the flattened key→index map the
 * keyboard navigation addresses rows through.
 *
 * Keying `index` on the composite identity matters — the same model id is served
 * by several providers, so an id-only key collapsed their rows onto one index
 * and hovering one highlighted every other provider's row.
 *
 * A row never appears twice: a favorite that is also recent is only listed under
 * FAVORITES, and neither rail repeats the row in its provider section.
 */
export function buildPickerGroups(
  models: AIModelOption[],
  search: string,
  collapsedSections: Record<string, boolean>,
  favoriteKeys: readonly string[],
  recentKeys: readonly string[],
): ModelPickerGroups {
  const query = search.trim().toLowerCase();
  const filtered = query
    ? models.filter(m =>
        m.name.toLowerCase().includes(query) ||
        m.provider.toLowerCase().includes(query) ||
        String(m.contextWindow ?? '').toLowerCase().includes(query) ||
        m.capabilities?.some(c => c.toLowerCase().includes(query))
      )
    : models;

  // The rails are ordered by the stored key lists, not by the catalog order.
  // A search narrows them like every other section — a starred model that does
  // not match the query must not sit above the results.
  const favorites = modelsInKeyOrder(filtered, favoriteKeys);
  const favoriteSet = new Set(favoriteKeys);
  const recent = modelsInKeyOrder(filtered, recentKeys).filter(m => !favoriteSet.has(modelKey(m)));

  const byProvider: Record<string, AIModelOption[]> = {};
  for (const model of filtered) {
    // `String(…)` rather than a bare call: this is the composer's picker, and a
    // row whose provider never landed must not take the chat input down. Rows
    // that reach here from `/api/models` are normalized in `toOption`; this is
    // the guard for every other caller (a plugin panel, a stored snapshot).
    // An EMPTY string is the same problem as a missing one — it would render a
    // heading with no name — so both land in `unknown`.
    const provider = String(model.provider || 'unknown').toUpperCase();
    (byProvider[provider] ??= []).push(model);
  }

  const visibleFlatList: AIModelOption[] = [];
  if (!collapsedSections['favorites']) visibleFlatList.push(...favorites);
  if (!collapsedSections['recent']) visibleFlatList.push(...recent);
  for (const [provider, groupModels] of Object.entries(byProvider)) {
    if (!collapsedSections[provider]) visibleFlatList.push(...groupModels);
  }

  const index: Record<string, number> = {};
  visibleFlatList.forEach((model, i) => {
    index[modelKey(model)] = i;
  });

  return { filtered, favorites, recent, byProvider, visibleFlatList, index };
}
