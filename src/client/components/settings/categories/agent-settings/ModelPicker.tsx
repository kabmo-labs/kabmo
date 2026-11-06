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
 *
 * Searchable, not a native `<select>`: the catalog is close to a hundred rows on
 * a real install, and picking one by scrolling an OS popup is the reason the
 * roles' picker was rebuilt.
 */

import { useModelsCatalog } from '@/client/hooks/models/use-models-catalog';
import { SearchSelect } from '@/client/components/common/search-select';

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

  const known = models.some((model) => model.selector === value);

  return (
    <SearchSelect
      ariaLabel="Override model"
      value={value}
      // "Not selected" is a real choice — it is how the override is removed, and
      // the row inherits the session model again.
      placeholder={NOT_SELECTED}
      onChange={onChange}
      disabled={disabled}
      className="w-full rounded-lg py-2 pl-2 pr-3 text-xs hover:border-ink/40 focus:border-ink disabled:opacity-60"
      options={[
        ...(value && !known ? [{ value, label: `${value} (not in catalog)` }] : []),
        ...models.map((model) => ({
          value: model.selector,
          label: model.name,
          hint: model.selector,
          group: model.provider,
        })),
      ]}
    />
  );
}
