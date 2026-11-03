/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * An agent's `model` frontmatter as a PICKER over the live catalog.
 *
 * omp resolves an agent's model from a `provider/model` selector, so a text box
 * invites a typo that silently falls back to the session model — the same trap
 * the model-role rows already avoid. The list is `/api/models` (the catalog the
 * composer uses), grouped by provider; a stored selector the catalog no longer
 * lists stays selectable so the form never rewrites a value it could not show.
 */

import { useMemo } from 'preact/hooks';
import { useModelsCatalog } from '@/client/hooks/models/use-models-catalog';

interface ModelPickerProps {
  value: string;
  disabled: boolean;
  onChange: (selector: string) => void;
}

const NOT_SELECTED = 'Not selected';

export function AgentModelPicker({ value, disabled, onChange }: ModelPickerProps) {
  const models = useModelsCatalog((data) => {
    if (!Array.isArray(data.modelList) || data.modelList.length === 0) return undefined;
    return data.modelList.map((entry) => ({
      selector: `${entry.provider}/${entry.id}`,
      provider: entry.provider,
      name: entry.name || entry.id,
    }));
  }) ?? [];

  const groups = useMemo(() => {
    const byProvider = new Map<string, Array<{ selector: string; name: string }>>();
    for (const model of models) {
      const bucket = byProvider.get(model.provider);
      if (bucket) bucket.push(model);
      else byProvider.set(model.provider, [model]);
    }
    return [...byProvider.entries()];
  }, [models]);

  const known = models.some((model) => model.selector === value);

  return (
    <select
      aria-label="Override model"
      value={value || NOT_SELECTED}
      onChange={(event) => {
        const next = event.currentTarget.value;
        onChange(next === NOT_SELECTED ? '' : next);
      }}
      disabled={disabled}
      className="w-full cursor-pointer rounded-lg border border-ink/20 bg-paper py-2 pl-2 pr-3 font-mono text-xs text-ink transition-colors hover:border-ink/40 focus:border-ink focus:outline-none disabled:opacity-60"
    >
      <option value={NOT_SELECTED}>{NOT_SELECTED} — inherits the session model</option>
      {value && !known && <option value={value}>{value} (not in catalog)</option>}
      {groups.map(([provider, entries]) => (
        <optgroup key={provider} label={provider}>
          {entries.map((model) => (
            <option key={model.selector} value={model.selector}>{model.name}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
