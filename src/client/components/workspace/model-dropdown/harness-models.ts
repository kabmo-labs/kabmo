/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * WHICH models the picker lists, for the harness its tab selects.
 *
 * Every harness has its own catalog and they are not interchangeable: omp's
 * registry serves 221 models from `models.yml`, claude publishes 5 aliases,
 * opencode 102 entries with its own capability flags, dsh exactly one. Showing
 * omp's list under the `claude` tab would offer a model that agent cannot run,
 * and picking it would fail at the first prompt.
 *
 * The rule is therefore: **the active tab decides the list.** Two sources exist
 * and only two:
 *
 *  - `omp-rpc` — Kabmo's `/api/models` (today's list, with favorites, recents
 *    and the provider plates), because that registry IS omp's;
 *  - every ACP harness — the `models[]` its own `session/new` returned, mapped
 *    into the same `AIModelOption` shape so the rows render identically.
 *
 * An unprobed ACP harness yields an EMPTY list plus the reason, never omp's
 * models as a stand-in.
 */

import type { AIModelOption } from '@/shared/types';
import type { HarnessSummary } from '@/shared/types/harness';

/** An `<option>`-style pair, as `configOptions` publishes them. */
export interface HarnessModelOption {
  value: string;
  name: string;
}

export interface HarnessModelList {
  /** Exactly the rows to render — never a union of two harnesses' catalogs. */
  models: AIModelOption[];
  /** True while the harness has never been probed, so the panel says "check
   *  status" instead of "no models". */
  unprobed: boolean;
  /** The agent's own refusal (auth, missing binary), if it has one. */
  blocked?: string;
}

/**
 * `provider/model` is how ACP spells a model value; the row's `provider` column
 * is the part before the slash and its `id` is the rest, which is exactly what
 * `set_config_option` wants back.
 */
function splitSelector(value: string): { provider: string; id: string } {
  const slash = value.indexOf('/');
  if (slash <= 0) return { provider: '', id: value };
  return { provider: value.slice(0, slash), id: value.slice(slash + 1) };
}

/** Map one ACP selector value into the picker's row shape. */
export function acpModelOption(option: HarnessModelOption, harness: string): AIModelOption {
  const { provider, id } = splitSelector(option.value);
  return {
    id,
    name: option.name || id,
    // The provider column groups rows, so a bare value (dsh publishes one
    // `["deepseek-official","deepseek-v4-flash"]` pair) still gets a heading.
    provider: provider || harness,
    // ACP publishes no context window or pricing — claiming one would be a
    // fabricated measurement. The row draws "—" for both.
    capabilities: ['Tool calling'],
  };
}

/**
 * The list the picker shows for `harness`.
 *
 * `ompModels` is the registry Kabmo already has (`/api/models`); it is returned
 * untouched for omp's own tab, because that list carries the favorites, the
 * recents and the provider plates the user built up. Any other harness REPLACES
 * it — never merges: two agents' models in one list is a row the tab does not
 * describe.
 */
export function harnessModels(
  harnesses: readonly HarnessSummary[],
  harness: string | undefined,
  ompModels: readonly AIModelOption[] = [],
): HarnessModelList {
  // No harness yet (a brand-new chat) → omp's registry, which is the default
  // agent and therefore the honest preview.
  if (!harness || harness === 'omp-rpc') return { models: [...ompModels], unprobed: false };

  const summary = harnesses.find((entry) => entry.id === harness);
  if (!summary) return { models: [], unprobed: true };
  const blocked = summary.probe?.capabilities.blocked ?? summary.unavailable;
  if (!summary.probe) return { models: [], unprobed: true, ...(blocked ? { blocked } : {}) };
  return {
    models: (summary.probe.models ?? []).map((option) => acpModelOption(option, harness)),
    unprobed: false,
    ...(blocked ? { blocked } : {}),
  };
}

/** The model a harness would start on, for the trigger's label. */
export function defaultHarnessModel(list: HarnessModelList): AIModelOption | null {
  return list.models[0] ?? null;
}
