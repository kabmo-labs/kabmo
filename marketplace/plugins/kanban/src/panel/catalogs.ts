/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The two catalogs the card sheet's pickers read, and the flattening they need.
 *
 * Both are Kabmo's own routes (`GET /api/harness`, `GET /api/models`), read
 * through `useKabmoFetch` — the same endpoints the composer's pickers use, so the
 * board cannot offer a harness or a model the chat would refuse. Nothing is
 * cached here: the fetch hook pauses while the panel is hidden, which is the
 * behaviour a plugin wants and a hand-rolled poll would forget.
 *
 * A harness whose models were never probed yields an EMPTY list plus the reason.
 * Showing omp's registry under the `claude` tab would offer a model that agent
 * cannot run — the rule `harnessModels` already enforces in the host.
 */

import { useKabmoFetch } from '@kabmo-labs/kabmo-ui';

/**
 * The part of `GET /api/harness` this panel reads.
 *
 * Deliberately a SUBSET: the route's own type lives in the host, and a plugin
 * cannot import it. Every field here is optional so a host that grows or drops
 * one leaves the pickers usable rather than broken.
 */
interface HarnessSummary {
  id: string;
  label?: string;
  enabled?: boolean;
  probe?: {
    models?: { value: string; name: string }[];
    thinking?: { value: string; name: string }[];
  } | null;
}

/** One row a model picker draws. */
export interface ModelChoice {
  provider: string;
  modelId: string;
  label: string;
}

/** The pickers' data, and why a list may be empty. */
export interface Catalogs {
  harnesses: { id: string; label: string; enabled: boolean }[];
  modelsFor: (harness: string) => ModelChoice[];
  thinkingFor: (harness: string) => string[];
  /** A harness's own reason it cannot list models, when it has one. */
  blockedFor: (harness: string) => string | null;
}

/** `provider/modelId` is how ACP spells a model; the row's provider is the prefix. */
function splitModel(value: string): { provider: string; modelId: string } {
  const slash = value.indexOf('/');
  if (slash <= 0) return { provider: '', modelId: value };
  return { provider: value.slice(0, slash), modelId: value.slice(slash + 1) };
}

/** ACP's `models[]` in the picker's shape. */
function acpChoices(summary: HarnessSummary): ModelChoice[] {
  const models = summary.probe?.models ?? [];
  return models.map((option) => {
    const split = splitModel(option.value);
    return { ...split, label: option.name || option.value };
  });
}

/** omp's registry in the picker's shape. */
function ompChoices(payload: unknown): ModelChoice[] {
  const record = (payload ?? {}) as { modelList?: unknown };
  const list = Array.isArray(record.modelList) ? record.modelList : [];
  const choices: ModelChoice[] = [];
  for (const entry of list) {
    const row = (entry ?? {}) as Record<string, unknown>;
    const provider = typeof row.provider === 'string' ? row.provider : '';
    const modelId = typeof row.id === 'string' ? row.id : typeof row.modelId === 'string' ? row.modelId : '';
    if (!provider || !modelId) continue;
    choices.push({ provider, modelId, label: typeof row.name === 'string' && row.name ? row.name : modelId });
  }
  return choices;
}

/** Read both catalogs once, for the sheet's pickers. */
export function useCatalogs(enabled: boolean): Catalogs {
  const harness = useKabmoFetch<HarnessSummary[]>('/api/harness', { enabled, pollMs: 0 });
  const models = useKabmoFetch<unknown>('/api/models', { enabled, pollMs: 0 });
  const summaries = Array.isArray(harness.data) ? harness.data : [];
  const omp = ompChoices(models.data);

  return {
    harnesses: summaries
      .filter((summary) => summary.enabled !== false)
      .map((summary) => ({ id: summary.id, label: summary.label || summary.id, enabled: summary.enabled !== false })),
    modelsFor: (id) => {
      if (id === 'omp-rpc') return omp;
      const summary = summaries.find((entry) => entry.id === id);
      return summary ? acpChoices(summary) : [];
    },
    thinkingFor: (id) => {
      const summary = summaries.find((entry) => entry.id === id);
      return (summary?.probe?.thinking ?? []).map((option) => option.value);
    },
    blockedFor: (id) => {
      if (id === 'omp-rpc') return omp.length === 0 ? 'omp has not reported its models yet' : null;
      const summary = summaries.find((entry) => entry.id === id);
      if (!summary) return 'This harness is not in the catalog';
      if (!summary.probe) return 'This harness has not reported its models yet';
      return (summary.probe.models?.length ?? 0) === 0 ? 'This harness reported no models' : null;
    },
  };
}
