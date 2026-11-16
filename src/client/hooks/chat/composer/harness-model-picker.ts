/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The model list behind `@harness:<id>:` in the composer.
 *
 * It is the SAME catalogue the model dropdown's tab shows for that harness
 * (`harnessModels`): omp's `/api/models` registry for `omp-rpc`, the live
 * session's published selectors first and the probe second for an ACP agent.
 * A second rule here would offer a model the agent refuses at spawn, which is
 * exactly what the dropdown was built to prevent.
 */

import { useEffect, useMemo, useState } from 'preact/hooks';
import type { AIModelOption, ComposerPickItem } from '@/shared/types';
import { useHarnesses } from '@/client/hooks/models/use-harnesses';
import { fetchModelsData, subscribeModelsUpdated } from '@/shared/lib/models/client';
import { modelEntryOption } from '@/shared/lib/models/option';
import { harnessModels, type HarnessModelList } from '@/shared/lib/harness/models';
import { harnessModelPickItems } from '@/shared/lib/chat/composer/harness-model-items';

export interface HarnessModelPickerState {
  items: ComposerPickItem[];
  loading: boolean;
  /** Why the list is empty, when the harness (or its probe) has an answer. */
  emptyText: string | null;
}

const UNPROBED = 'This harness has not reported its models yet.';

function emptyTextFor(list: HarnessModelList): string | null {
  if (list.models.length > 0) return null;
  if (list.blocked) return list.blocked;
  if (list.unprobed) return UNPROBED;
  return null;
}

/**
 * `harness` is null whenever the popup is not completing a model, so an idle
 * composer costs no `/api/models` read and no harness-catalog subscription.
 */
export function useHarnessModelPicker(harness: string | null): HarnessModelPickerState {
  const { harnesses, liveModels, isLoading } = useHarnesses({ enabled: harness !== null });
  const [ompModels, setOmpModels] = useState<AIModelOption[]>([]);
  const [ompLoading, setOmpLoading] = useState(false);

  useEffect(() => {
    if (harness !== 'omp-rpc') return;
    let active = true;
    setOmpLoading(true);
    const load = async () => {
      try {
        const data = await fetchModelsData();
        if (!active || !Array.isArray(data.modelList)) return;
        setOmpModels(data.modelList.map(modelEntryOption));
      } catch {
        // The empty state is the honest answer: a failed read must not leave
        // rows the registry no longer serves.
      } finally {
        if (active) setOmpLoading(false);
      }
    };
    void load();
    const off = subscribeModelsUpdated(() => {
      void load();
    });
    return () => {
      active = false;
      off();
    };
  }, [harness]);

  return useMemo(() => {
    if (!harness) return { items: [], loading: false, emptyText: null };
    const list = harnessModels(harnesses, harness, ompModels, liveModels[harness]);
    return {
      items: harnessModelPickItems(list.models, harness),
      loading: list.models.length === 0 && (harness === 'omp-rpc' ? ompLoading : isLoading),
      emptyText: emptyTextFor(list),
    };
  }, [harness, harnesses, ompModels, liveModels, ompLoading, isLoading]);
}
