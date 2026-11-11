/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The harness, model, thinking and access picks for a scheduled task.
 *
 * A task runs with nobody watching, so the snapshot has to be explicit: the
 * harness decides the transport and the model catalog, and the model/thinking
 * picks are replayed at dispatch. The list is the SAME one the composer shows
 * (`harnessModels`), so a task cannot offer a model the agent would refuse.
 *
 * The model value is `provider/modelId` — the shape both transports accept
 * (`set_model` for omp, `session/set_config_option` for ACP). An empty value
 * means "the harness's default": omp falls back to the composer's persisted
 * pick, an ACP agent to its own configured default.
 */

import { useHarnesses } from '@/client/hooks/models/use-harnesses';
import { useModelsCatalog } from '@/client/hooks/models/use-models-catalog';
import {
  harnessModels,
  pickerHarnesses,
} from '@/client/components/workspace/model-dropdown/harness-models';
import { APPROVAL_MODES, type ApprovalMode } from '@/shared/lib/omp/config/access-mode';
import { selectableThinkingLevels } from '@/shared/lib/models/thinking-levels';
import type { AIModelOption } from '@/shared/types';
import type { ScheduledTaskModel } from '@/shared/types/schedule';

interface ModelFieldsProps {
  harness: string;
  model: ScheduledTaskModel | null;
  onHarnessChange: (harness: string) => void;
  onModelChange: (model: ScheduledTaskModel | null) => void;
}

const ACCESS_LABELS: Record<ApprovalMode, string> = {
  'always-ask': 'Ask before writes',
  write: 'Auto-write, ask before exec',
  yolo: 'Auto-run everything',
};

function modelKey(option: AIModelOption): string {
  return `${option.provider}/${option.id}`;
}

/**
 * The picker rows from either catalog shape: the real `/api/models` answers
 * `modelList`, while the mock catalog answers `models` as an array. Narrowing
 * here keeps a malformed entry out of the picker instead of rendering a blank
 * row.
 */
function toPickerOptions(entries: unknown): AIModelOption[] {
  if (!Array.isArray(entries)) return [];
  const options: AIModelOption[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    if (!('id' in entry) || typeof entry.id !== 'string') continue;
    if (!('name' in entry) || typeof entry.name !== 'string') continue;
    if (!('provider' in entry) || typeof entry.provider !== 'string') continue;
    const thinkingLevels =
      'thinkingLevels' in entry && Array.isArray(entry.thinkingLevels)
        ? entry.thinkingLevels.filter((level: unknown): level is string => typeof level === 'string')
        : undefined;
    options.push({
      id: entry.id,
      name: entry.name,
      provider: entry.provider,
      ...(thinkingLevels ? { thinkingLevels } : {}),
    });
  }
  return options;
}

export function ModelFields({ harness, model, onHarnessChange, onModelChange }: ModelFieldsProps) {
  const { harnesses } = useHarnesses();
  // The scheduler only needs the picker's identity and thinking ladder; the
  // registry's cost/context fields are not drawn here.
  const ompModels = useModelsCatalog((data) => {
    const list = Array.isArray(data.modelList) && data.modelList.length > 0 ? data.modelList : data.models;
    return toPickerOptions(list);
  });
  const list = harnessModels(harnesses, harness, ompModels ?? []);
  const options = list.models;
  const selected = model
    ? options.find((option) => option.provider === model.provider && option.id === model.modelId)
    : undefined;
  const thinkingLevels = selectableThinkingLevels(selected?.thinkingLevels);
  const harnessOptions = pickerHarnesses(harnesses, harness);

  const pickModel = (value: string) => {
    if (!value) {
      onModelChange(null);
      return;
    }
    const option = options.find((entry) => modelKey(entry) === value);
    if (!option) return;
    onModelChange({
      provider: option.provider,
      modelId: option.id,
      // `auto` leaves omp's level untouched and is skipped by an ACP agent that
      // publishes no such value, so it is the honest default for both.
      thinkingLevel: 'auto',
      accessMode: model?.accessMode ?? 'always-ask',
    });
  };

  const pickThinking = (level: string) => {
    if (!model) return;
    onModelChange({ ...model, thinkingLevel: level });
  };

  const pickAccess = (mode: ApprovalMode) => {
    if (!model) return;
    onModelChange({ ...model, accessMode: mode });
  };

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block font-semibold mb-1 text-ink">Harness</label>
          <select
            value={harness}
            onChange={(e) => onHarnessChange(e.currentTarget.value)}
            className="w-full bg-paper border border-ink/20 rounded px-2 py-1.5 outline-none focus:border-ink/50 text-xs"
          >
            {!harnessOptions.some((entry) => entry.id === harness) && (
              <option value={harness}>{harness}</option>
            )}
            {harnessOptions.map((entry) => (
              <option key={entry.id} value={entry.id}>{entry.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block font-semibold mb-1 text-ink">Model</label>
          <select
            value={model ? `${model.provider}/${model.modelId}` : ''}
            onChange={(e) => pickModel(e.currentTarget.value)}
            className="w-full bg-paper border border-ink/20 rounded px-2 py-1.5 outline-none focus:border-ink/50 text-xs"
          >
            <option value="">
              {harness === 'omp-rpc' ? 'Default (composer selection)' : 'Harness default'}
            </option>
            {model && !options.some((option) => option.provider === model.provider && option.id === model.modelId) && (
              <option value={`${model.provider}/${model.modelId}`}>
                {model.provider}/{model.modelId}
              </option>
            )}
            {options.map((option) => (
              <option key={modelKey(option)} value={modelKey(option)}>
                {option.name} · {option.provider}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block font-semibold mb-1 text-ink">Thinking</label>
          <select
            value={model?.thinkingLevel ?? 'auto'}
            disabled={!model || thinkingLevels.length === 0}
            onChange={(e) => pickThinking(e.currentTarget.value)}
            className="w-full bg-paper border border-ink/20 rounded px-2 py-1.5 outline-none focus:border-ink/50 text-xs disabled:opacity-40"
          >
            <option value="auto">Auto</option>
            {model && model.thinkingLevel !== 'auto' && !thinkingLevels.includes(model.thinkingLevel) && (
              <option value={model.thinkingLevel}>{model.thinkingLevel}</option>
            )}
            {thinkingLevels.map((level) => (
              <option key={level} value={level}>{level}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block font-semibold mb-1 text-ink">Access</label>
          <select
            value={model?.accessMode ?? 'always-ask'}
            disabled={!model}
            onChange={(e) => pickAccess(e.currentTarget.value as ApprovalMode)}
            className="w-full bg-paper border border-ink/20 rounded px-2 py-1.5 outline-none focus:border-ink/50 text-xs disabled:opacity-40"
          >
            {APPROVAL_MODES.map((mode) => (
              <option key={mode} value={mode}>{ACCESS_LABELS[mode]}</option>
            ))}
          </select>
        </div>
      </div>

      {list.blocked && <p className="text-[11px] text-error">{list.blocked}</p>}
      {list.unprobed && (
        <p className="text-[11px] text-ink/40">
          This harness has not been probed yet; its models appear after a status check.
        </p>
      )}
    </div>
  );
}
