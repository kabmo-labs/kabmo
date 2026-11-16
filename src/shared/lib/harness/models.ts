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
 * The rule is therefore: **the active tab decides the list.** Three sources
 * exist, and they are ranked:
 *
 *  - `omp-rpc` — Kabmo's `/api/models` (today's list, with favorites, recents
 *    and the provider plates), because that registry IS omp's;
 *  - an ACP harness with a LIVE chat — the selectors that session itself
 *    published (`get_state` → `configOptions`), because that is the list the
 *    agent is offering right now. A probe runs its OWN spawn, so it can refuse
 *    (codex asks for authentication in the probe while the chat that is
 *    already running lists its models) and its answer ages;
 *  - an ACP harness with no live chat — the `models[]` its own probe
 *    `session/new` returned, mapped into the same `AIModelOption` shape so the
 *    rows render identically.
 *
 * An ACP harness with neither yields an EMPTY list plus the reason, never omp's
 * models as a stand-in.
 */

import type { AIModelOption } from '@/shared/types';
import type { HarnessSelectorValue, HarnessSummary, LiveHarnessModels } from '@/shared/types/harness';

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
export function acpModelOption(
  option: HarnessSelectorValue,
  harness: string,
  thinking: readonly HarnessSelectorValue[] = [],
): AIModelOption {
  const { provider, id } = splitSelector(option.value);
  return {
    id,
    name: option.name || id,
    // The provider column groups rows, so a bare value (dsh publishes one
    // `["deepseek-official","deepseek-v4-flash"]` pair) still gets a heading.
    provider: provider || harness,
    // The agent's `thought_level` ladder is a SESSION selector, not a per-model
    // one, so every row carries the same values. Without it the composer's
    // thinking dropdown was disabled on every ACP chat — the pick never reached
    // `set_thinking_level`, which the transport does implement.
    ...(thinking.length > 0 ? { thinkingLevels: thinking.map((entry) => entry.value) } : {}),
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
 *
 * `live` is what the OPEN chat's own session published, when it is running on
 * this harness. It wins over `probe` (see the module header).
 */
export function harnessModels(
  harnesses: readonly HarnessSummary[],
  harness: string | undefined,
  ompModels: readonly AIModelOption[] = [],
  live?: LiveHarnessModels | null,
): HarnessModelList {
  // No harness yet (a brand-new chat) → omp's registry, which is the default
  // agent and therefore the honest preview.
  if (!harness || harness === 'omp-rpc') return { models: [...ompModels], unprobed: false };

  const summary = harnesses.find((entry) => entry.id === harness);
  if (!summary) return { models: [], unprobed: true };

  // What the OPEN CHAT published outranks what one spawn measured: the live
  // session is the one about to receive the pick.
  const liveModels = live?.models ?? [];
  const published = liveModels.length > 0 ? liveModels : (summary.probe?.models ?? []);
  const thinking = live?.thinking?.length ? live.thinking : (summary.probe?.thinking ?? []);
  if (published.length === 0) {
    const blocked = summary.probe?.capabilities.blocked ?? summary.unavailable;
    return { models: [], unprobed: !summary.probe, ...(blocked ? { blocked } : {}) };
  }
  // A block is evidence about a DIFFERENT spawn; saying "Authentication
  // required" beside rows the running chat is offering would contradict the list
  // it sits on, so only an uninstalled harness keeps its refusal here.
  const blocked = liveModels.length > 0 ? undefined : summary.unavailable;
  return {
    models: published.map((option) => acpModelOption(option, harness, thinking)),
    unprobed: false,
    ...(blocked ? { blocked } : {}),
  };
}

/** The model a harness would start on, for the trigger's label. */
export function defaultHarnessModel(list: HarnessModelList): AIModelOption | null {
  return list.models[0] ?? null;
}

/**
 * The harnesses the composer's tab strip may offer.
 *
 * A harness the user switched OFF is absent — that is what switching it off
 * means — but the harness OWNING the open chat is never removed: an existing
 * conversation has to be able to name the agent that ran it, even after the user
 * cleared their roster. Switching it back on is the All Harnesses page's job.
 *
 * Lives here rather than in the picker because this module already owns "which
 * harnesses this list is about", and a second copy of the rule is how the tabs
 * and the model rows start disagreeing about what is on the roster.
 */
export function pickerHarnesses(
  harnesses: readonly HarnessSummary[],
  activeHarness: string | null | undefined,
): HarnessSummary[] {
  return harnesses.filter((entry) => entry.enabled || entry.id === activeHarness);
}
