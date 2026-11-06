/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One role row: the role's name, its id, and a MODEL PICKER.
 *
 * A provider-GROUPED picker rather than a text field: the value is a
 * `provider/model` selector, which a user cannot be expected to type correctly
 * (and a typo in `modelRoles` is a role that silently falls back), while the
 * picker offers only models omp's own catalog can resolve.
 *
 * It is a SEARCHABLE list, not a native `<select>`: omp serves 221 models on this
 * machine, and the OS popup shows them as one scroll box with no filter. The
 * grouping survives as headings, and typing "sonnet" narrows across providers.
 *
 * The current value is always present as a row, even when the catalog no longer
 * lists it (a model removed from models.yml, a provider whose credential was
 * removed, a catalog read that failed): dropping it would show a different model
 * than the config holds, and the next edit would write that one over it.
 */

import { SearchSelect } from '@/client/components/common/search-select';
import type { ModelRoleCandidate } from '@/shared/types/model-roles';
import type { ModelRoleInfo } from '@/shared/lib/omp/config/model-roles';

interface RoleRowProps {
  role: string;
  info: ModelRoleInfo;
  value: string;
  candidates: ModelRoleCandidate[];
  disabled: boolean;
  onChange: (role: string, value: string) => void;
}

export function RoleRow({ role, info, value, candidates, disabled, onChange }: RoleRowProps) {
  const known = candidates.some((candidate) => candidate.selector === value);
  const label = `${info.label} (${role}) model`;

  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5">
      <div className="min-w-0">
        <div className="font-medium text-ink">{info.label}</div>
        <div className="font-mono text-[10px] text-ink/35">{role}</div>
      </div>
      <SearchSelect
        ariaLabel={label}
        value={value}
        // omp decides a role it has no opinion about; that is a real choice, so
        // it is the placeholder row and not an absent value.
        placeholder="omp default"
        onChange={(next) => onChange(role, next)}
        disabled={disabled}
        className="w-60 max-w-[60%]"
        options={[
          // A saved selector the catalog has dropped stays offered: omp still
          // resolves it, and silently swapping it would rewrite the user's role.
          ...(value && !known ? [{ value, label: `${value} (not in catalog)` }] : []),
          ...candidates.map((candidate) => ({
            value: candidate.selector,
            label: candidate.name,
            hint: candidate.selector,
            group: candidate.provider,
          })),
        ]}
      />
    </div>
  );
}
