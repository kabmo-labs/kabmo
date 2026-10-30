/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import type { AIModelOption } from '@/shared/types';
import { modelKey } from '@/shared/lib/models/identity';

/** One rendered row: the model plus the section it is drawn in. */
export interface PickerRow {
  /**
   * Identity of the ROW, not of the model: `${section}::${modelKey}`.
   *
   * A model appears in a rail AND in its provider section (a favorite that is
   * not removed from its provider list), so a `modelKey`-keyed map could only
   * describe one of the two rows — the other's hover index pointed at its
   * sibling, both lit up together, and the specs card anchored to whichever row
   * `querySelector` found first.
   */
  rowId: string;
  model: AIModelOption;
}

export interface ModelPickerGroups {
  filtered: AIModelOption[];
  favorites: AIModelOption[];
  recent: AIModelOption[];
  /** Provider display name (upper-cased) → its models, in catalog order. */
  byProvider: Record<string, AIModelOption[]>;
  /**
   * Lower-cased model names served by MORE THAN ONE provider, over the whole
   * catalog. Rows in a rail carry their provider tag only for these: an
   * unconditional tag is noise on the 95% of rows whose name is already unique,
   * and the rails have no provider header to disambiguate them.
   */
  ambiguousNames: ReadonlySet<string>;
  /** Sections expanded, in the order the panel renders them. */
  visibleFlatList: PickerRow[];
  /** Row id → index in `visibleFlatList`, for hover/keyboard focus. */
  index: Record<string, number>;
}

/** Row identity: a section id plus the composite model key. */
export function rowIdFor(section: string, model: { provider: string; id: string }): string {
  return `${section}::${modelKey(model)}`;
}

/** The name a row displays, normalized for the ambiguity check. */
export function normalizedModelName(model: AIModelOption): string {
  return String(model.name ?? '').trim().toLowerCase();
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
  // A key is claimed once. A stored list that repeats a key (hand-edited, or
  // written by an older build) would otherwise draw the same row twice with the
  // same row id, and the second copy would steal the first one's hover index
  // and specs anchor.
  const claimed = new Set<string>();
  for (const key of keys) {
    if (claimed.has(key)) continue;
    const match = byKey.get(key);
    if (!match) continue;
    claimed.add(key);
    ordered.push(match);
  }
  return ordered;
}

/**
 * Names that cannot identify a row on their own, computed over the UNFILTERED
 * catalog: a tag that appeared only while the search narrowed the list would
 * flicker as the reader types.
 *
 * The provider is compared case-insensitively for the same reason the sections
 * are (`DEEPSEEK` heads both `deepseek` and `DeepSeek`): one provider spelled two
 * ways is still one provider, and tagging those rows would claim an ambiguity
 * that does not exist.
 */
function findAmbiguousNames(models: AIModelOption[]): ReadonlySet<string> {
  const providersByName = new Map<string, Set<string>>();
  for (const model of models) {
    const name = normalizedModelName(model);
    if (!name) continue;
    const providers = providersByName.get(name) ?? new Set<string>();
    providers.add(String(model.provider || 'unknown').toUpperCase());
    providersByName.set(name, providers);
  }
  const ambiguous = new Set<string>();
  for (const [name, providers] of providersByName) {
    if (providers.size > 1) ambiguous.add(name);
  }
  return ambiguous;
}

/**
 * All derived picker state in one place: search filtering, the favorites/recent
 * rails, the per-provider grouping, and the flattened row→index map the
 * keyboard navigation addresses rows through.
 *
 * Keying `index` on the ROW matters twice over: the same model id is served by
 * several providers (an id-only key lit every provider's row), and one model is
 * drawn in a rail and again in its provider section (a model-keyed index
 * collapsed those two rows onto one entry).
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

  const visibleFlatList: PickerRow[] = [];
  const push = (section: string, sectionModels: AIModelOption[]) => {
    for (const model of sectionModels) {
      visibleFlatList.push({ rowId: rowIdFor(section, model), model });
    }
  };
  if (!collapsedSections['favorites']) push('favorites', favorites);
  if (!collapsedSections['recent']) push('recent', recent);
  for (const [provider, groupModels] of Object.entries(byProvider)) {
    if (!collapsedSections[provider]) push(provider, groupModels);
  }

  const index: Record<string, number> = {};
  visibleFlatList.forEach((row, i) => {
    index[row.rowId] = i;
  });

  return {
    filtered,
    favorites,
    recent,
    byProvider,
    ambiguousNames: findAmbiguousNames(models),
    visibleFlatList,
    index,
  };
}
