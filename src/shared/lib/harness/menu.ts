/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One settings MEUN entry per harness, derived from the catalog.
 *
 * A harness is a subject with its own config, its own providers and its own
 * state, so it gets its own page rather than a card in a list of thirteen. The
 * ids are therefore DYNAMIC (`harness:claude`) instead of twelve more members of
 * the `SettingsCategoryId` union: the catalog is what decides which agents this
 * build knows, and a union entry per harness would mean a build-time edit for
 * every adapter added at runtime.
 *
 * The index page (`harness-index`) keeps the overview the old single page gave —
 * every agent with its status and install hint — because a sidebar of fourteen
 * agents with no "is any of this installed?" summary is a list, not an overview.
 */

import type { SettingsCategoryId } from '@/shared/types/settings/state';
import { HARNESS_IDS, harnessDescriptor } from '@/shared/lib/harness/catalog';

/** The prefix that makes a category a harness page. */
export const HARNESS_CATEGORY_PREFIX = 'harness:';

/** The overview page's id. */
export const HARNESS_INDEX_CATEGORY = 'harness-index';

/** `harness:claude` for `claude`. */
export function harnessCategoryId(id: string): SettingsCategoryId {
  return `${HARNESS_CATEGORY_PREFIX}${id}` as SettingsCategoryId;
}

/** The harness a category names, or null when it names something else. */
export function harnessIdFromCategory(category: string): string | null {
  if (!category.startsWith(HARNESS_CATEGORY_PREFIX)) return null;
  const id = category.slice(HARNESS_CATEGORY_PREFIX.length);
  return id || null;
}

/** True for the overview page or any single harness page. */
export function isHarnessCategory(category: string): boolean {
  return category === HARNESS_INDEX_CATEGORY || category.startsWith(HARNESS_CATEGORY_PREFIX);
}

export interface HarnessMenuEntry {
  id: SettingsCategoryId;
  label: string;
  description: string;
  /** The harness id, or null for the overview page. */
  harness: string | null;
}

/**
 * The harness menu, in catalog order.
 *
 * The BUILT-IN transport is left out for the reason it has no card: `omp` over
 * RPC has nothing to install, probe or configure, and a page whose only content
 * is "this is built in" is a dead entry in a menu.
 *
 * A harness the user SWITCHED OFF gets no row in the DRAWER, but it keeps its
 * entry here: this list is the catalog's answer, and whether a given install
 * currently shows an agent is the roster's (`omp_harness_disabled`). The sidebar
 * filters with it, and the All Harnesses overview — which always lists every
 * agent — is where a switched-off one is switched back on.
 */
export function harnessMenuEntries(ids: readonly string[] = HARNESS_IDS): HarnessMenuEntry[] {
  const entries: HarnessMenuEntry[] = [
    {
      id: HARNESS_INDEX_CATEGORY as SettingsCategoryId,
      label: 'All Harnesses',
      description: 'Status, install hints and probe results for every agent Kabmo can drive.',
      harness: null,
    },
  ];
  for (const id of ids) {
    const descriptor = harnessDescriptor(id);
    if (!descriptor || descriptor.builtIn) continue;
    entries.push({
      id: harnessCategoryId(id),
      label: descriptor.label,
      description: `${descriptor.label}: ${descriptor.transport === 'rpc' ? 'native RPC' : 'ACP over stdio'}. Providers, launch command, and the defaults a new chat starts on.`,
      harness: id,
    });
  }
  return entries;
}
